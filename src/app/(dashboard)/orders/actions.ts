'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { dailyKey } from '@/lib/business-lookup';
import { colorComboKey, pickUnusedColor } from '@/lib/color-palette';
import { loadAppSettings } from '@/lib/settings-server';
import { editableDateError } from '@/lib/order-date';
import { describeSizeSpec, parseSizeSpec } from '@/lib/size-spec';
import { parseKakaoMessage, normalizeUnit, type ParsedBusinessLine, type ParsedProduct } from '@/lib/kakao-parser';
import { repairFailedLine } from '@/lib/kakao-ai-repair';
import { prepOf, type OrderRound } from '@/lib/orders';
import { requirePermission } from '@/lib/permissions/access';

// parseLine이 "터미널/업체명/상품" 3분할 자체에 실패했을 때만 붙는 고정 reviewReason —
// AI fallback은 이 줄 단위 실패 케이스만 대상으로 한다(상품 단위 사소한 오류는 그대로
// needsReview로 사람이 확인 화면에서 고치는 기존 흐름 유지).
const LINE_SPLIT_FAILURE_REASON = "구분자 '/'가 정확히 2개가 아니거나 빈 항목이 있음 (터미널/업체명/상품 형식과 불일치)";

// 취소 줄처럼 상품 정보가 의미 없는 제안에 쓰는 자리표시 상품.
function blankProduct(raw: string, productName: string): ParsedProduct {
  return {
    raw,
    productName,
    quantity: 0,
    unit: '',
    secondaryWeightKg: null,
    sizeRequest: null,
    isMulbong: false,
    hasAerator: false,
    mulbongBoxCount: null,
    hasIcePack: false,
    fromStock: false,
    isCancel: true,
    needsReview: false,
  };
}

export interface OrderHistoryEntry {
  id: string;
  rawText: string;
  createdAt: string;
  createdByName: string | null;
  round: OrderRound;
  // 그 차수의 첫 입력이면 true
  isFirst: boolean;
}

// 날짜별 카카오 메시지 입력 이력(1차·2차 모두, 시간순). 각 차수의 첫 로그를 최초주문, 이후를 업데이트로
// 구분한다 — 메시지 내용이 아니라 그 차수에서 몇 번째로 들어왔는지로만 판단한다.
export async function getOrderHistory(orderDate: string): Promise<OrderHistoryEntry[]> {
  await requirePermission('orders:view');
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from('kakao_message_log')
    .select('id, raw_text, created_at, created_by, round')
    .eq('order_date', orderDate)
    .order('created_at', { ascending: true });

  const creatorIds = [...new Set((logs ?? []).map((log) => log.created_by).filter((id): id is string => id != null))];
  const { data: profiles } = creatorIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', creatorIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const seenRounds = new Set<OrderRound>();
  return (logs ?? []).map((log) => {
    const isFirst = !seenRounds.has(log.round);
    seenRounds.add(log.round);
    return {
      id: log.id,
      rawText: log.raw_text,
      createdAt: log.created_at,
      createdByName: log.created_by ? nameById.get(log.created_by) ?? null : null,
      round: log.round,
      isFirst,
    };
  });
}

// no_change: 이미 등록된 상품과 수량/중량/옵션이 모두 같아서 확정해도 바뀌는 게 없는 줄.
export type LineSuggestionKind = 'new_business' | 'new_line' | 'update_line' | 'no_change' | 'cancel_line';

export interface SuggestedLine {
  key: string;
  terminalName: string;
  businessNameRaw: string;
  matchedBusinessId: string | null;
  matchedBusinessName: string | null;
  product: ParsedProduct;
  kind: LineSuggestionKind;
  existingOrderItemId: string | null;
  needsReview: boolean;
  reviewReason?: string;
  // 수량을 못 찾았지만 기존 상품을 덮어쓰는 게 아니라서 "수량 미정"으로 추가할 수 있는 줄(수량 0, 단위 없음으로 저장).
  undecidedQuantity?: boolean;
  source: 'regex' | 'ai';
  // true면 확정에 포함할 수 없는 줄(취소 대상 없음, 수량 없이 기존 상품을 덮어쓰기) — 확인 화면에서 자동으로 제외된다.
  blocking: boolean;
  memo?: string;
  normalizedFrom?: string;
  // 사이즈/종류 요구사항을 해석한 결과(확인 화면에 "400g ~ 600g" 같은 칩으로 보여준다)
  sizeSpecText: string[];
  sizeSpecUnparsed: string[];
  // 등록된 적 없는 터미널/업체 — 확정하면 주문입력 출처로 자동 등록된다.
  isNewTerminal: boolean;
  isNewBusiness: boolean;
}

// 읽기 전용: 붙여넣은 텍스트를 파싱하고, 각 줄의 업체명을 업체 카탈로그 전체와 대조해서
// 신규/업데이트를 줄 단위로 제안한다. 아무것도 쓰지 않는다 — 확정은 commitOrderLines가 한다.
export async function suggestOrderLines(rawText: string, orderDate: string, round: OrderRound): Promise<SuggestedLine[]> {
  await requirePermission('orders:edit');
  const supabase = await createClient();
  const parsedLines = parseKakaoMessage(rawText);

  // 서로 의존하지 않는 조회는 한 번에 보낸다(DB 왕복이 곧 대기 시간).
  const settings = await loadAppSettings(supabase);
  const dateError = editableDateError(orderDate, settings.allowPastOrderEdit);
  if (dateError) throw new Error(dateError);
  const [{ data: allBusinesses }, { data: registeredTerminals }, { data: dailyBusinesses }] = await Promise.all([

    supabase.from('businesses').select('id, name, terminal_id'),
    supabase.from('terminals').select('id, name'),
    supabase.from('daily_businesses').select('id, business_id, terminal_id').eq('order_date', orderDate).eq('round', round),
  ]);
  const businessList = allBusinesses ?? [];
  const terminalNameSet = new Set((registeredTerminals ?? []).map((t) => t.name));

  // 3분할 자체가 깨진 줄만 골라 AI에게 재구성을 맡긴다 — 실패해도(키 미설정 포함) null이
  // 돌아올 뿐이라 원래 정규식 결과(빈 상품 목록 + needsReview)가 그대로 쓰인다.
  const needsAiRepair = (line: ParsedBusinessLine) =>
    line.products.length === 0 && line.reviewReason === LINE_SPLIT_FAILURE_REASON;

  let resolvedLines: Array<{ line: ParsedBusinessLine; source: 'regex' | 'ai' }>;
  if (parsedLines.some(needsAiRepair)) {
    const terminalNames = (registeredTerminals ?? []).map((t) => t.name);
    const businessNames = businessList.map((b) => b.name);

    resolvedLines = await Promise.all(
      parsedLines.map(async (line) => {
        if (!needsAiRepair(line)) return { line, source: 'regex' as const };
        const repaired = await repairFailedLine(line.raw, { terminalNames, businessNames });
        return repaired ? { line: repaired, source: 'ai' as const } : { line, source: 'regex' as const };
      }),
    );
  } else {
    resolvedLines = parsedLines.map((line) => ({ line, source: 'regex' as const }));
  }

  const dailyRows = dailyBusinesses ?? [];
  // 같은 업체도 터미널이 다르면 다른 카드다(0029) — "남부"로 보내는 날과 "택배"로 보내는 날, 또는 한 차수 안의 두 터미널.
  const dailyIdByKey = new Map(dailyRows.map((d) => [dailyKey(d.business_id, d.terminal_id), d.id]));
  const terminalIdByName = new Map((registeredTerminals ?? []).map((t) => [t.name, t.id]));

  const dailyBusinessIds = dailyRows.map((d) => d.id);
  const { data: existingItems } =
    dailyBusinessIds.length > 0
      ? await supabase
          .from('order_items')
          .select('id, daily_business_id, product_name_raw, quantity, unit, secondary_weight_kg, size_request, is_mulbong, has_aerator, mulbong_box_count, has_ice_pack, from_stock, change_status')
          .in('daily_business_id', dailyBusinessIds)
      : { data: [] };

  type ExistingItem = NonNullable<typeof existingItems>[number];
  const existingItemsByDailyBusiness = new Map<string, ExistingItem[]>();
  for (const item of existingItems ?? []) {
    const list = existingItemsByDailyBusiness.get(item.daily_business_id) ?? [];
    list.push(item);
    existingItemsByDailyBusiness.set(item.daily_business_id, list);
  }

  const suggestions: SuggestedLine[] = [];

  for (const { line, source } of resolvedLines) {
    // 업체명은 정확히 같을 때만 같은 업체로 본다 — 한두 글자 다른 이름(스시고유/스시고본)이 실제로
    // 서로 다른 업체라서, 비슷하다고 자동으로 합치면 다른 업체의 주문이 섞인다.
    const matched = businessList.find((b) => b.name === line.businessName);
    const catalogBusinessId = matched?.id ?? null;
    // 줄에 터미널을 적었으면 그 터미널의 카드, 안 적었으면 업체 기본 터미널의 카드를 갱신 대상으로 본다.
    // 등록되지 않은 터미널이면 아직 카드가 없다.
    const lineTerminalId = line.terminalName ? terminalIdByName.get(line.terminalName) ?? null : matched?.terminal_id ?? null;
    const lineTerminalUnknown = line.terminalName !== '' && !lineTerminalId;
    const dailyBusinessId = catalogBusinessId && !lineTerminalUnknown ? dailyIdByKey.get(dailyKey(catalogBusinessId, lineTerminalId)) ?? null : null;
    const existingItems = dailyBusinessId ? existingItemsByDailyBusiness.get(dailyBusinessId) ?? [] : [];

    const base = {
      terminalName: line.terminalName,
      businessNameRaw: line.businessName,
      matchedBusinessId: catalogBusinessId,
      matchedBusinessName: matched?.name ?? null,
      memo: line.memo,
      source,
      isNewTerminal: line.terminalName !== '' && !terminalNameSet.has(line.terminalName),
      isNewBusiness: catalogBusinessId === null,
    };

    // 업체 줄 전체 취소("터미널/ 업체명/ 취소") — 그 업체의 살아있는 상품을 하나씩 취소로 펼친다.
    if (line.cancelAll) {
      const targets = existingItems.filter((i) => i.change_status !== 'cancelled');
      if (targets.length === 0) {
        suggestions.push({
          ...base,
          key: `${line.raw}__cancel`,
          product: blankProduct(line.raw, `${line.businessName} 전체`),
          kind: 'cancel_line',
          existingOrderItemId: null,
          needsReview: true,
          blocking: true,
          sizeSpecText: [],
          sizeSpecUnparsed: [],
          reviewReason: '취소할 오늘 주문이 없습니다',
        });
      }
      targets.forEach((item, idx) => {
        suggestions.push({
          ...base,
          key: `${line.raw}__cancel${idx}`,
          product: blankProduct(line.raw, item.product_name_raw),
          kind: 'cancel_line',
          existingOrderItemId: item.id,
          needsReview: false,
          blocking: false,
          sizeSpecText: [],
          sizeSpecUnparsed: [],
        });
      });
      continue;
    }

    line.products.forEach((product, idx) => {
      // 같은 상품도 물봉·기포기·일반은 준비 방식이 달라 별개 줄이다(예: "보리새우 30미(일반, 물봉)"과 "(일반, 기포기)"). 취소는 상품명만으로 찾는다.
      const existing = existingItems.find((i) => i.product_name_raw === product.productName && (product.isCancel || prepOf({ isMulbong: i.is_mulbong, hasAerator: i.has_aerator }) === prepOf(product)));
      const spec = parseSizeSpec(product.sizeRequest, settings);
      const common = {
        ...base,
        key: `${line.raw}__${idx}`,
        product,
        normalizedFrom: product.normalizedFrom,
        sizeSpecText: describeSizeSpec(spec),
        sizeSpecUnparsed: spec.unparsed,
      };

      if (product.isCancel) {
        const alreadyCancelled = existing?.change_status === 'cancelled';
        suggestions.push({
          ...common,
          kind: existing && !alreadyCancelled ? 'cancel_line' : 'no_change',
          existingOrderItemId: existing?.id ?? null,
          needsReview: !existing,
          blocking: !existing,
          reviewReason: existing ? undefined : '취소할 상품이 오늘 주문에 없습니다',
        });
        return;
      }

      let kind: LineSuggestionKind;
      let existingOrderItemId: string | null = null;
      if (!dailyBusinessId) {
        kind = 'new_business';
      } else if (existing) {
        const same =
          existing.change_status !== 'cancelled' &&
          Number(existing.quantity) === product.quantity &&
          normalizeUnit(existing.unit) === product.unit &&
          (existing.secondary_weight_kg ?? null) === product.secondaryWeightKg &&
          (existing.size_request ?? null) === (product.sizeRequest ?? null) &&
          existing.is_mulbong === product.isMulbong &&
          existing.has_aerator === product.hasAerator &&
          (existing.mulbong_box_count ?? null) === (product.mulbongBoxCount ?? null) &&
          existing.has_ice_pack === product.hasIcePack &&
          existing.from_stock === product.fromStock;
        kind = same ? 'no_change' : 'update_line';
        existingOrderItemId = existing.id;
      } else {
        kind = 'new_line';
      }

      // 수량이 없는 상품: 새 상품이면 "수량 미정"(수량 0, 단위 없음)으로 대시보드에 올릴 수 있게 한다.
      // 이미 있는 상품이면 수량 없이 덮어쓰면 기존 수량이 0이 되므로 이 줄은 제외 대상으로 둔다.
      const missingQuantity = product.quantity <= 0;
      const undecidedQuantity = missingQuantity && !existing;
      suggestions.push({
        ...common,
        kind,
        existingOrderItemId,
        // 같은 줄의 다른 상품 하나가 문제라고 정상 상품까지 확인 필요로 만들지 않는다 — 상품 단위로만
        // 판단한다. 단, AI가 재구성한 줄은 모든 상품이 항상 사람 확인 대상이다.
        needsReview: product.needsReview || missingQuantity || source === 'ai',
        blocking: missingQuantity && !!existing,
        undecidedQuantity,
        reviewReason: undecidedQuantity ? '수량 미정으로 추가됩니다 (나중에 대시보드에서 수량을 채우세요)' : product.reviewReason ?? (missingQuantity ? '이미 있는 상품이라 수량 없이는 바꿀 수 없습니다' : source === 'ai' ? line.reviewReason : undefined),
      });
    });
  }

  return suggestions;
}

export interface LineDecision {
  terminalName: string;
  businessNameRaw: string;
  matchedBusinessId: string | null;
  product: ParsedProduct;
  kind: LineSuggestionKind;
  existingOrderItemId: string | null;
  memo?: string;
}

// 상품 목록에 없는 이름은 주문입력 출처로 자동 등록하고, 기존 상품이 쓰는 색과 겹치지 않는 색을 배정한다.
async function registerNewProducts(supabase: Awaited<ReturnType<typeof createClient>>, names: string[]) {
  if (names.length === 0) return;
  const { data: existing } = await supabase.from('products').select('name, fill_color, border_color');
  const known = new Set((existing ?? []).map((p) => p.name));
  const used = new Set((existing ?? []).filter((p) => p.fill_color || p.border_color).map((p) => colorComboKey(p.fill_color, p.border_color)));

  const rows = names
    .filter((n) => !known.has(n))
    .map((name) => {
      const color = pickUnusedColor(used);
      used.add(colorComboKey(color.fill_color, color.border_color));
      return { name, created_via: 'order' as const, ...color };
    });
  if (rows.length > 0) await supabase.from('products').upsert(rows, { onConflict: 'name', ignoreDuplicates: true });
}

// 사람이 확인 화면에서 확정한 대로 실제로 반영한다. 업체번호/상품순서는 여기서 처음이자
// 한 번만 assign_*_number RPC로 발급한다(append-only, 재사용 없음).
//
// DB 왕복 횟수가 곧 지연 시간이므로(서버↔DB 왕복 1회 = 수십~수백 ms) 줄마다 조회/삽입하지 않고
// 터미널 → 업체 → 오늘 카드 → 상품 순으로 단계별로 모아서 한 번에 처리한다.
export async function commitOrderLines(orderDate: string, round: OrderRound, decisions: LineDecision[], rawText?: string) {
  await requirePermission('orders:edit');
  const supabase = await createClient();
  const [{ data: claims }, logCount, settings] = await Promise.all([
    supabase.auth.getClaims(),
    rawText
      ? supabase.from('kakao_message_log').select('id', { count: 'exact', head: true }).eq('order_date', orderDate)
      : Promise.resolve(null),
    loadAppSettings(supabase),
  ]);
  const userId = claims?.claims.sub ?? null;
  const dateError = editableDateError(orderDate, settings.allowPastOrderEdit);
  if (dateError) throw new Error(dateError);

  // 그날 첫 입력(로그가 아직 없음)으로 들어오는 상품은 "최초주문"(none), 이후 입력으로 새로 들어오는
  // 상품은 "추가됨"(new)으로 구분한다 — 대시보드에서 오전 최초 주문과 이후 추가분을 한눈에 가른다.
  const isFirstInputOfDay = (logCount?.count ?? 0) === 0;
  if (rawText) {
    await supabase.from('kakao_message_log').insert({ order_date: orderDate, round, raw_text: rawText, created_by: userId });
  }

  const active = decisions.filter((d) => d.kind !== 'no_change');
  const cancelIds = active
    .filter((d) => d.kind === 'cancel_line' && d.existingOrderItemId)
    .map((d) => d.existingOrderItemId as string);
  const lines = active.filter((d) => d.kind !== 'cancel_line');

  const cancelPromise = cancelIds.length
    ? supabase.from('order_items').update({ change_status: 'cancelled' }).in('id', cancelIds)
    : null;

  // 1) 터미널 — 등록되지 않은 이름은 주문입력 출처로 한 번에 자동 등록한다.
  const terminalNames = [...new Set(lines.map((d) => d.terminalName).filter(Boolean))];
  const terminalIdByName = new Map<string, string>();
  if (terminalNames.length > 0) {
    const { data: existing } = await supabase.from('terminals').select('id, name').in('name', terminalNames);
    for (const t of existing ?? []) terminalIdByName.set(t.name, t.id);
    const missing = terminalNames.filter((n) => !terminalIdByName.has(n));
    if (missing.length > 0) {
      const { data: created } = await supabase
        .from('terminals')
        .insert(missing.map((name) => ({ name, created_via: 'order' as const })))
        .select('id, name');
      for (const t of created ?? []) terminalIdByName.set(t.name, t.id);
    }
  }

  // 2) 업체 — 분석 때 기존 업체와 매칭되지 않은 이름만 찾아보고, 없으면 한 번에 만든다.
  const unmatched = lines.filter((d) => !d.matchedBusinessId);
  const unmatchedNames = [...new Set(unmatched.map((d) => d.businessNameRaw))];
  const businessIdByName = new Map<string, string>();
  if (unmatchedNames.length > 0) {
    const { data: existing } = await supabase.from('businesses').select('id, name').in('name', unmatchedNames);
    for (const b of existing ?? []) businessIdByName.set(b.name, b.id);
    const missing = unmatchedNames.filter((n) => !businessIdByName.has(n));
    if (missing.length > 0) {
      const { data: created } = await supabase
        .from('businesses')
        .insert(
          missing.map((name) => ({
            name,
            terminal_id: terminalIdByName.get(unmatched.find((d) => d.businessNameRaw === name)?.terminalName ?? '') ?? null,
            created_via: 'order' as const,
          })),
        )
        .select('id, name');
      for (const b of created ?? []) businessIdByName.set(b.name, b.id);
    }
  }
  // 줄에 터미널이 없으면 업체 기본 터미널을 쓴다(방금 만든 업체는 위에서 줄의 터미널로 만들어졌다).
  const resolvedBase = lines.flatMap((d) => {
    const businessId = d.matchedBusinessId ?? businessIdByName.get(d.businessNameRaw);
    return businessId ? [{ decision: d, businessId }] : [];
  });
  const defaultTerminalIdByBusiness = new Map<string, string | null>();
  if (resolvedBase.length > 0) {
    const { data: defaults } = await supabase.from('businesses').select('id, terminal_id').in('id', [...new Set(resolvedBase.map((r) => r.businessId))]);
    for (const b of defaults ?? []) defaultTerminalIdByBusiness.set(b.id, b.terminal_id);
  }
  const resolved = resolvedBase.map((r) => {
    const terminalId = r.decision.terminalName ? terminalIdByName.get(r.decision.terminalName) ?? null : defaultTerminalIdByBusiness.get(r.businessId) ?? null;
    return { ...r, terminalId, key: dailyKey(r.businessId, terminalId) };
  });

  // 3) 오늘 업체 카드 — 같은 업체·터미널이 여러 줄에 나와도 한 번만. 번호는 등장 순서대로 하나씩 발급한다.
  const cardKeys = [...new Map(resolved.map((r) => [r.key, r])).values()];
  const dailyIdByKey = new Map<string, string>();
  if (cardKeys.length > 0) {
    const { data: existing } = await supabase
      .from('daily_businesses')
      .select('id, business_id, terminal_id')
      .eq('order_date', orderDate)
      .eq('round', round)
      .in('business_id', [...new Set(cardKeys.map((r) => r.businessId))]);
    for (const d of existing ?? []) dailyIdByKey.set(dailyKey(d.business_id, d.terminal_id), d.id);

    const rowsToCreate: { order_date: string; business_id: string; business_number: number; round: OrderRound; terminal_id: string | null }[] = [];
    for (const card of cardKeys) {
      if (dailyIdByKey.has(card.key)) continue;
      const { data: businessNumber } = await supabase.rpc('assign_business_number', { p_order_date: orderDate });
      rowsToCreate.push({ order_date: orderDate, business_id: card.businessId, business_number: businessNumber ?? 0, round, terminal_id: card.terminalId });
    }
    if (rowsToCreate.length > 0) {
      const { data: created } = await supabase.from('daily_businesses').insert(rowsToCreate).select('id, business_id, terminal_id');
      for (const d of created ?? []) dailyIdByKey.set(dailyKey(d.business_id, d.terminal_id), d.id);
    }
  }

  const productRegistration = registerNewProducts(supabase, [...new Set(resolved.map((r) => r.decision.product.productName))]);

  // 4) 상품 — 수정은 병렬로, 신규는 업체별 순번을 순서대로 발급(업체끼리는 병렬)한 뒤 한 번에 삽입한다.
  const memoByDaily = new Map<string, string>();
  const updates: Promise<unknown>[] = [];
  const newByDaily = new Map<string, ParsedProduct[]>();

  for (const { decision, key } of resolved) {
    const dailyBusinessId = dailyIdByKey.get(key);
    if (!dailyBusinessId) continue;
    // 메모는 업체 카드 단위로 한 번만 반영한다(같은 업체의 여러 상품 줄에 같은 메모가 실려 온다).
    if (decision.memo && !memoByDaily.has(dailyBusinessId)) memoByDaily.set(dailyBusinessId, decision.memo);

    const { product } = decision;
    if (decision.kind === 'update_line' && decision.existingOrderItemId) {
      // 주문 수량이 미출고 수량보다 작아지면 미출고 수량도 맞춘다(필터가 맞을 때만 실행되는 조건부 갱신).
      updates.push(
        Promise.resolve(
          supabase.from('order_items').update({ unshipped_quantity: product.quantity }).eq('id', decision.existingOrderItemId).gt('unshipped_quantity', product.quantity),
        ),
      );
      updates.push(
        Promise.resolve(
          supabase
            .from('order_items')
            .update({
              quantity: product.quantity,
              unit: product.unit,
              secondary_weight_kg: product.secondaryWeightKg,
              size_request: product.sizeRequest,
              size_spec: parseSizeSpec(product.sizeRequest, settings),
              is_mulbong: product.isMulbong,
              has_aerator: product.hasAerator,
              mulbong_box_count: product.mulbongBoxCount,
              has_ice_pack: product.hasIcePack,
              from_stock: product.fromStock,
              change_status: 'modified',
              needs_review: product.needsReview,
              review_reason: product.reviewReason ?? null,
            })
            .eq('id', decision.existingOrderItemId),
        ),
      );
    } else {
      const list = newByDaily.get(dailyBusinessId) ?? [];
      list.push(product);
      newByDaily.set(dailyBusinessId, list);
    }
  }

  for (const [dailyBusinessId, memo] of memoByDaily) {
    updates.push(Promise.resolve(supabase.from('daily_businesses').update({ memo }).eq('id', dailyBusinessId)));
  }
  if (cancelPromise) updates.push(Promise.resolve(cancelPromise));

  const newRowGroups = await Promise.all(
    [...newByDaily].map(async ([dailyBusinessId, products]) => {
      const rows = [];
      for (const product of products) {
        const { data: sequence } = await supabase.rpc('assign_product_sequence', { p_daily_business_id: dailyBusinessId });
        rows.push({
          daily_business_id: dailyBusinessId,
          product_sequence: sequence ?? 0,
          product_name_raw: product.productName,
          quantity: product.quantity,
          unit: product.unit,
          secondary_weight_kg: product.secondaryWeightKg,
          size_request: product.sizeRequest,
          size_spec: parseSizeSpec(product.sizeRequest, settings),
          is_mulbong: product.isMulbong,
          has_aerator: product.hasAerator,
          mulbong_box_count: product.mulbongBoxCount,
          has_ice_pack: product.hasIcePack,
          from_stock: product.fromStock,
          change_status: isFirstInputOfDay ? ('none' as const) : ('new' as const),
          needs_review: product.needsReview,
          review_reason: product.reviewReason ?? null,
          created_by: userId,
        });
      }
      return rows;
    }),
  );
  const newRows = newRowGroups.flat();
  if (newRows.length > 0) {
    const { error } = await supabase.from('order_items').insert(newRows);
    if (error) throw new Error(`상품 저장 실패: ${error.message}`);
  }
  await Promise.all([...updates, productRegistration]);

  revalidatePath('/dashboard');
  revalidatePath('/terminals');
  revalidatePath('/businesses');
  revalidatePath('/products');
}
