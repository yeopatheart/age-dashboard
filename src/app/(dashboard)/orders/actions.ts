'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assignBusinessNumber, dailyKey, separateTerminalIds } from '@/lib/business-lookup';
import { colorComboKey, pickUnusedColor } from '@/lib/color-palette';
import { loadAppSettings } from '@/lib/settings-server';
import { newOrderItemRow } from '@/lib/order-item-row';
import { stripGluedOrderNumber } from '@/lib/glued-order-number';
import { commitFailureMessage, deleteCreatedCards, firstResultError, isFrameworkSignal, runInChunks, type CleanupResult } from '@/lib/commit-failure';
import { editableDateError } from '@/lib/order-date';
import { describeSizeSpec, parseSizeSpec } from '@/lib/size-spec';
import { parseKakaoMessage, normalizeUnit, type ParsedBusinessLine, type ParsedProduct } from '@/lib/kakao-parser';
import { repairFailedLine } from '@/lib/kakao-ai-repair';
import { prepOf, type OrderRound } from '@/lib/orders';
import { similarProductNames, suspiciousNameReason } from '@/lib/product-name-check';
import { requirePermission } from '@/lib/permissions/access';
import { emptyEffects, hasEffects, parseEffects, planUndo, summarizeEffects, type EffectsSummary, type InputEffects, type ItemBefore } from '@/lib/order-input-undo';
import { missingTable } from '@/lib/supabase/missing-table';
import { fetchAll, selectAll } from '@/lib/supabase/fetch-all';
import { isIsoDate, nonNegativeNumberError, textError } from '@/lib/validate';

// parseLine이 "터미널/업체명/상품" 3분할 자체에 실패했을 때만 붙는 고정 reviewReason —
// AI fallback은 이 줄 단위 실패 케이스만 대상으로 한다(상품 단위 사소한 오류는 그대로
// needsReview로 사람이 확인 화면에서 고치는 기존 흐름 유지).
const LINE_SPLIT_FAILURE_REASON = "구분자 '/'가 정확히 2개가 아니거나 빈 항목이 있음 (터미널/업체명/상품 형식과 불일치)";

// Anthropic 호출은 유료다. 붙여넣는 글자 수와 AI에 맡기는 줄 수·동시 호출 수를 제한해 비용 폭주를 막는다.
const MAX_RAW_TEXT_CHARS = 20000;
const MAX_AI_REPAIR_LINES = 30;
const AI_REPAIR_CONCURRENCY = 3;
const MAX_DECISIONS = 500;

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
  // 상품 마스터에 없는 이름 — 확정하면 주문입력 출처로 자동 등록된다. 비슷한 기존 상품이 있으면 오타 중복일 수 있어 함께 보여 준다(자동으로 합치지 않는다).
  isNewProduct: boolean;
  similarProducts: string[];
}

// 읽기 전용: 붙여넣은 텍스트를 파싱하고, 각 줄의 업체명을 업체 카탈로그 전체와 대조해서
// 신규/업데이트를 줄 단위로 제안한다. 아무것도 쓰지 않는다 — 확정은 commitOrderLines가 한다.
export async function suggestOrderLines(rawText: string, orderDate: string, round: OrderRound): Promise<SuggestedLine[]> {
  await requirePermission('orders:edit');
  if (rawText.length > MAX_RAW_TEXT_CHARS) throw new Error(`한 번에 붙여넣을 수 있는 글자 수(${MAX_RAW_TEXT_CHARS.toLocaleString()}자)를 넘었습니다. 나눠서 입력해주세요.`);
  const supabase = await createClient();
  const parsedLines = parseKakaoMessage(rawText);

  // 서로 의존하지 않는 조회는 한 번에 보낸다(DB 왕복이 곧 대기 시간).
  const settings = await loadAppSettings(supabase);
  const dateError = editableDateError(orderDate, settings.allowPastOrderEdit, { allowTomorrow: true });
  if (dateError) throw new Error(dateError);
  const [{ data: allBusinesses }, { data: registeredTerminals }, { data: dailyBusinesses }, knownProducts] = await Promise.all([

    fetchAll((from, to) => supabase.from('businesses').select('id, name, terminal_id').order('id').range(from, to), '업체 조회 실패: ').then((data) => ({ data })),
    supabase.from('terminals').select('id, name'),
    supabase.from('daily_businesses').select('id, business_id, terminal_id').eq('order_date', orderDate).eq('round', round),
    fetchAll((from, to) => supabase.from('products').select('name').order('id').range(from, to), '상품 조회 실패: '),
  ]);
  const knownProductNames = new Set(knownProducts.map((p) => p.name));
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

    // 상한을 넘는 줄은 AI에 맡기지 않고 정규식 결과(확인 필요)로 둔다. 동시 호출 수도 제한한다.
    const aiTargets = parsedLines.map((line, index) => ({ line, index })).filter(({ line }) => needsAiRepair(line)).slice(0, MAX_AI_REPAIR_LINES);
    const repairedByIndex = new Map<number, ParsedBusinessLine>();
    for (let i = 0; i < aiTargets.length; i += AI_REPAIR_CONCURRENCY) {
      await Promise.all(
        aiTargets.slice(i, i + AI_REPAIR_CONCURRENCY).map(async ({ line, index }) => {
          const repaired = await repairFailedLine(line.raw, { terminalNames, businessNames });
          if (repaired) repairedByIndex.set(index, repaired);
        }),
      );
    }
    resolvedLines = parsedLines.map((line, index) => {
      const repaired = repairedByIndex.get(index);
      return repaired ? { line: repaired, source: 'ai' as const } : { line, source: 'regex' as const };
    });
  } else {
    resolvedLines = parsedLines.map((line) => ({ line, source: 'regex' as const }));
  }

  // 번호가 터미널 이름에 붙어 온 줄("20남부")은 새 터미널로 만들지 않고 번호와 등록된 터미널로 나눈다.
  resolvedLines = resolvedLines.map(({ line, source }) => ({ line: stripGluedOrderNumber(line, terminalNameSet), source }));

  const dailyRows = dailyBusinesses ?? [];
  // 같은 업체도 터미널이 다르면 다른 카드다(0029) — "남부"로 보내는 날과 "택배"로 보내는 날, 또는 한 차수 안의 두 터미널.
  const dailyIdByKey = new Map(dailyRows.map((d) => [dailyKey(d.business_id, d.terminal_id), d.id]));
  const terminalIdByName = new Map((registeredTerminals ?? []).map((t) => [t.name, t.id]));

  const dailyBusinessIds = dailyRows.map((d) => d.id);
  const { data: existingItems } =
    dailyBusinessIds.length > 0
      ? await selectAll((from, to) => supabase
          .from('order_items')
          .select('id, daily_business_id, product_name_raw, quantity, unit, secondary_weight_kg, size_request, is_mulbong, has_aerator, mulbong_box_count, has_ice_pack, from_stock, change_status')
          .in('daily_business_id', dailyBusinessIds).order('id').range(from, to), '주문 줄 조회 실패: ')
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
    // 줄에 터미널을 적었으면 그 터미널의 카드, 안 적었으면 터미널 "미지정" 카드를 갱신 대상으로 본다(업체 기본 터미널로 보내지 않는다 — 2026-11-15 결정).
    // 등록되지 않은 터미널이면 아직 카드가 없다.
    const lineTerminalId = line.terminalName ? terminalIdByName.get(line.terminalName) ?? null : null;
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
      isNewProduct: false,
      similarProducts: [] as string[],
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

    // 읽지 못한 줄(형식이 깨졌고 AI 보정도 못 한 줄, 상품이 하나도 없는 줄)은 조용히 사라지지 않게 원문 그대로 "자동 제외" 행으로 보여 준다.
    if (line.products.length === 0) {
      suggestions.push({
        ...base,
        key: `${line.raw}__unreadable`,
        businessNameRaw: line.raw,
        terminalName: '',
        matchedBusinessId: null,
        matchedBusinessName: null,
        isNewTerminal: false,
        isNewBusiness: false,
        product: blankProduct(line.raw, line.raw),
        kind: 'no_change',
        existingOrderItemId: null,
        needsReview: true,
        blocking: true,
        sizeSpecText: [],
        sizeSpecUnparsed: [],
        reviewReason: '읽지 못한 줄입니다 (터미널/ 업체명/ 상품 형식으로 적어주세요)',
      });
      continue;
    }

    line.products.forEach((product, idx) => {
      // 같은 상품도 물봉·기포기·일반은 준비 방식이 달라 별개 줄이다(예: "보리새우 30미(일반, 물봉)"과 "(일반, 기포기)"). 취소는 상품명만으로 찾는다.
      const existing = existingItems.find((i) => i.product_name_raw === product.productName && (product.isCancel || prepOf({ isMulbong: i.is_mulbong, hasAerator: i.has_aerator }) === prepOf(product)));
      const spec = parseSizeSpec(product.sizeRequest, settings);
      const isNewProduct = !product.isCancel && product.productName !== '' && !knownProductNames.has(product.productName);
      const suspicious = isNewProduct ? suspiciousNameReason(product.productName) : null;
      const common = {
        ...base,
        isNewProduct,
        similarProducts: isNewProduct ? similarProductNames(product.productName, knownProductNames) : [],
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
        needsReview: product.needsReview || missingQuantity || source === 'ai' || suspicious !== null,
        blocking: missingQuantity && !!existing,
        undecidedQuantity,
        reviewReason: undecidedQuantity ? '수량 미정으로 추가됩니다 (나중에 대시보드에서 수량을 채우세요)' : product.reviewReason ?? (missingQuantity ? '이미 있는 상품이라 수량 없이는 바꿀 수 없습니다' : source === 'ai' ? line.reviewReason : suspicious ?? undefined),
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
  aiRepaired?: boolean; // AI가 형식을 벗어난 줄을 재구성한 줄이면 true(SuggestedLine.source === 'ai'). order_items.ai_repaired(0055)에 남긴다
}

// 상품 목록에 없는 이름은 주문입력 출처로 자동 등록하고, 기존 상품이 쓰는 색과 겹치지 않는 색을 배정한다.
async function registerNewProducts(supabase: Awaited<ReturnType<typeof createClient>>, names: string[]) {
  if (names.length === 0) return;
  const existing = await fetchAll((from, to) => supabase.from('products').select('name, fill_color, border_color').order('id').range(from, to), '상품 조회 실패: ');
  const known = new Set(existing.map((p) => p.name));
  const used = new Set(existing.filter((p) => p.fill_color || p.border_color).map((p) => colorComboKey(p.fill_color, p.border_color)));

  const rows = names
    .filter((n) => !known.has(n))
    .map((name) => {
      const color = pickUnusedColor(used);
      used.add(colorComboKey(color.fill_color, color.border_color));
      return { name, created_via: 'order' as const, ...color };
    });
  if (rows.length === 0) return;
  const { error } = await supabase.from('products').upsert(rows, { onConflict: 'name', ignoreDuplicates: true });
  if (error) throw new Error(`상품 자동 등록 실패: ${error.message}`);
}

// 사람이 확인 화면에서 확정한 대로 실제로 반영한다. 업체번호/상품순서는 여기서 처음이자
// 한 번만 assign_*_number RPC로 발급한다(append-only, 재사용 없음).
//
// DB 왕복 횟수가 곧 지연 시간이므로(서버↔DB 왕복 1회 = 수십~수백 ms) 줄마다 조회/삽입하지 않고
// 터미널 → 업체 → 오늘 카드 → 상품 순으로 단계별로 모아서 한 번에 처리한다.
// 확정이 중간에 실패했을 때 뒷정리에 필요한 것: 이번 확정이 새로 만든 업체 카드, 상품 줄이 저장됐는지.
interface CommitState {
  createdDailyIds: string[];
  itemsSaved: boolean;
  // 이번 입력이 한 일(되돌리기용 기록, order_input_batches). 새 줄·수정·취소·메모를 모으고 상품 저장이 끝난 뒤 한 번에 남긴다.
  effects: InputEffects;
}

// 수정·취소하기 전의 값을 읽을 열(되돌릴 때 이 값으로 돌린다).
const BEFORE_COLUMNS = 'id, product_name_raw, quantity, unit, secondary_weight_kg, size_request, size_spec, is_mulbong, has_aerator, mulbong_box_count, has_ice_pack, from_stock, change_status, needs_review, review_reason, unshipped_quantity';

// itemsSaved: 새 상품 줄은 이미 저장된 뒤의 실패다(같은 내용을 다시 확정하면 새 줄이 중복된다).
export type CommitResult = { ok: true } | { ok: false; error: string; itemsSaved: boolean };

// 실패하면 던지지 않고 원인 문구를 값으로 돌려준다(운영에서는 던진 오류의 문구가 가려져 "Minified React error #441"로만 보였다).
// 상품 줄이 저장되기 전에 실패하면 이번에 만든 업체 카드를 지워서 "고객사만 남은" 반쪽 상태를 만들지 않는다(2026-11-15).
export async function commitOrderLines(orderDate: string, round: OrderRound, decisions: LineDecision[], rawText?: string): Promise<CommitResult> {
  const state: CommitState = { createdDailyIds: [], itemsSaved: false, effects: emptyEffects() };
  try {
    await commitOrderLinesInto(state, orderDate, round, decisions, rawText);
    return { ok: true };
  } catch (error) {
    if (isFrameworkSignal(error)) throw error;
    console.error('[commitOrderLines] failed', error);
    let cleaned: CleanupResult = { attempted: 0, error: null };
    if (!state.itemsSaved) {
      const supabase = await createClient();
      cleaned = await deleteCreatedCards(state.createdDailyIds, (ids) => supabase.from('daily_businesses').delete().in('id', ids));
      if (cleaned.error) console.error('[commitOrderLines] cleanup failed', cleaned.error);
    }
    return { ok: false, error: commitFailureMessage(error, cleaned, state.itemsSaved), itemsSaved: state.itemsSaved };
  }
}

async function commitOrderLinesInto(state: CommitState, orderDate: string, round: OrderRound, decisions: LineDecision[], rawText?: string) {
  const access = await requirePermission('orders:edit');
  // 확인 화면을 거치지 않고 직접 호출해도 이상한 값이 DB에 들어가지 않도록 서버에서 한 번 더 검사한다.
  if (!isIsoDate(orderDate)) throw new Error('날짜 형식이 올바르지 않습니다.');
  if (decisions.length > MAX_DECISIONS) throw new Error(`한 번에 반영할 수 있는 줄 수(${MAX_DECISIONS}줄)를 넘었습니다.`);
  if (rawText !== undefined && rawText.length > MAX_RAW_TEXT_CHARS) throw new Error('붙여넣은 글자 수가 너무 많습니다.');
  for (const d of decisions) {
    if (d.kind === 'no_change' || d.kind === 'cancel_line') continue;
    const invalid =
      textError(d.businessNameRaw, '업체명', 60) ??
      textError(d.product.productName, '상품명', 100) ??
      nonNegativeNumberError(d.product.quantity, '수량') ??
      (d.terminalName ? textError(d.terminalName, '터미널', 30) : null);
    if (invalid) throw new Error(invalid);
  }
  const supabase = await createClient();
  const [logCount, settings] = await Promise.all([
    rawText
      ? supabase.from('kakao_message_log').select('id', { count: 'exact', head: true }).eq('order_date', orderDate)
      : Promise.resolve(null),
    loadAppSettings(supabase),
  ]);
  const userId = access.userId;
  const dateError = editableDateError(orderDate, settings.allowPastOrderEdit, { allowTomorrow: true });
  if (dateError) throw new Error(dateError);

  // 그날 첫 입력(로그가 아직 없음)으로 들어오는 상품은 "최초주문"(none), 이후 입력으로 새로 들어오는
  // 상품은 "추가됨"(new)으로 구분한다 — 대시보드에서 오전 최초 주문과 이후 추가분을 한눈에 가른다.
  const isFirstInputOfDay = (logCount?.count ?? 0) === 0;

  const active = decisions.filter((d) => d.kind !== 'no_change');
  const cancelIds = active
    .filter((d) => d.kind === 'cancel_line' && d.existingOrderItemId)
    .map((d) => d.existingOrderItemId as string);
  const lines = active.filter((d) => d.kind !== 'cancel_line');

  // 수정·취소할 줄의 이전 값을 먼저 읽어 둔다(되돌리기용). 아무것도 바꾸기 전에 읽으므로 읽지 못하면 여기서 멈춘다.
  const updateIds = lines.filter((d) => d.kind === 'update_line' && d.existingOrderItemId).map((d) => d.existingOrderItemId as string);
  const touchedIds = [...new Set([...updateIds, ...cancelIds])];
  const beforeById = new Map<string, ItemBefore & { product_name_raw: string }>();
  if (touchedIds.length > 0) {
    const { data: beforeRows, error: beforeError } = await supabase.from('order_items').select(BEFORE_COLUMNS).in('id', touchedIds);
    if (beforeError) throw new Error(`수정할 상품의 이전 값을 읽지 못했습니다: ${beforeError.message}`);
    for (const r of beforeRows ?? []) {
      beforeById.set(r.id, {
        product_name_raw: r.product_name_raw,
        quantity: Number(r.quantity),
        unit: r.unit,
        secondary_weight_kg: r.secondary_weight_kg == null ? null : Number(r.secondary_weight_kg),
        size_request: r.size_request,
        size_spec: r.size_spec,
        is_mulbong: r.is_mulbong,
        has_aerator: r.has_aerator,
        mulbong_box_count: r.mulbong_box_count == null ? null : Number(r.mulbong_box_count),
        has_ice_pack: r.has_ice_pack,
        from_stock: r.from_stock,
        change_status: r.change_status,
        needs_review: r.needs_review,
        review_reason: r.review_reason,
        unshipped_quantity: Number(r.unshipped_quantity ?? 0),
      });
    }
  }
  const recordChange = (id: string, kind: 'modified' | 'cancelled', after: { quantity: number; unit: string }) => {
    const before = beforeById.get(id);
    if (!before || state.effects.changedItems.some((c) => c.id === id)) return;
    if (kind === 'cancelled' && before.change_status === 'cancelled') return; // 이미 취소된 줄은 되돌릴 것이 없다
    const { product_name_raw: productName, ...rest } = before;
    state.effects.changedItems.push({ id, kind, productName, before: rest, after });
  };
  for (const id of cancelIds) {
    const before = beforeById.get(id);
    if (before) recordChange(id, 'cancelled', { quantity: before.quantity, unit: before.unit });
  }

  const cancelPromise = cancelIds.length
    ? supabase.from('order_items').update({ change_status: 'cancelled' }).in('id', cancelIds)
    : null;

  // 1) 터미널 — 등록되지 않은 이름은 주문입력 출처로 한 번에 자동 등록한다.
  const terminalNames = [...new Set(lines.map((d) => d.terminalName).filter(Boolean))];
  const terminalIdByName = new Map<string, string>();
  if (terminalNames.length > 0) {
    const { data: existing, error: terminalLookupError } = await supabase.from('terminals').select('id, name').in('name', terminalNames);
    if (terminalLookupError) throw new Error(`터미널 조회 실패: ${terminalLookupError.message}`);
    for (const t of existing ?? []) terminalIdByName.set(t.name, t.id);
    const missing = terminalNames.filter((n) => !terminalIdByName.has(n));
    if (missing.length > 0) {
      const { data: created, error: terminalError } = await supabase
        .from('terminals')
        .insert(missing.map((name) => ({ name, created_via: 'order' as const })))
        .select('id, name');
      if (terminalError) throw new Error(`터미널 등록 실패: ${terminalError.message}`);
      for (const t of created ?? []) terminalIdByName.set(t.name, t.id);
    }
  }

  // 2) 업체 — 분석 때 기존 업체와 매칭되지 않은 이름만 찾아보고, 없으면 한 번에 만든다.
  const unmatched = lines.filter((d) => !d.matchedBusinessId);
  const unmatchedNames = [...new Set(unmatched.map((d) => d.businessNameRaw))];
  const businessIdByName = new Map<string, string>();
  if (unmatchedNames.length > 0) {
    const { data: existing, error: businessLookupError } = await supabase.from('businesses').select('id, name').in('name', unmatchedNames);
    if (businessLookupError) throw new Error(`업체 조회 실패: ${businessLookupError.message}`);
    for (const b of existing ?? []) businessIdByName.set(b.name, b.id);
    const missing = unmatchedNames.filter((n) => !businessIdByName.has(n));
    if (missing.length > 0) {
      const { data: created, error: businessError } = await supabase
        .from('businesses')
        .insert(
          missing.map((name) => ({
            name,
            terminal_id: terminalIdByName.get(unmatched.find((d) => d.businessNameRaw === name)?.terminalName ?? '') ?? null,
            created_via: 'order' as const,
          })),
        )
        .select('id, name');
      if (businessError) throw new Error(`업체 등록 실패: ${businessError.message}`);
      for (const b of created ?? []) businessIdByName.set(b.name, b.id);
    }
  }
  // 줄에 터미널이 없으면 터미널 "미지정"(null) 카드로 만든다. 업체 기본 터미널로 보내지 않는다.
  const resolvedBase = lines.flatMap((d) => {
    const businessId = d.matchedBusinessId ?? businessIdByName.get(d.businessNameRaw);
    return businessId ? [{ decision: d, businessId }] : [];
  });
  const resolved = resolvedBase.map((r) => {
    const terminalId = r.decision.terminalName ? terminalIdByName.get(r.decision.terminalName) ?? null : null;
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
    const separateIds = await separateTerminalIds(supabase, cardKeys.map((r) => r.terminalId));
    for (const card of cardKeys) {
      if (dailyIdByKey.has(card.key)) continue;
      const businessNumber = await assignBusinessNumber(supabase, orderDate, card.terminalId !== null && separateIds.has(card.terminalId));
      rowsToCreate.push({ order_date: orderDate, business_id: card.businessId, business_number: businessNumber, round, terminal_id: card.terminalId });
    }
    if (rowsToCreate.length > 0) {
      const { data: created, error: dailyError } = await supabase.from('daily_businesses').insert(rowsToCreate).select('id, business_id, terminal_id');
      if (dailyError) throw new Error(`주문 카드 생성 실패: ${dailyError.message}`);
      for (const d of created ?? []) {
        dailyIdByKey.set(dailyKey(d.business_id, d.terminal_id), d.id);
        state.createdDailyIds.push(d.id);
      }
    }
  }

  // 4) 상품 — 수정은 병렬로, 신규는 업체별 순번을 순서대로 발급(업체끼리는 병렬)한 뒤 한 번에 삽입한다.
  const memoByDaily = new Map<string, string>();
  // 기존 줄 수정·취소·메모는 새 줄 저장이 성공한 뒤에 실행한다(새 줄 저장이 실패했을 때 기존 줄만 바뀌어 남지 않게 함수로 모아 둔다).
  const updates: (() => PromiseLike<unknown>)[] = [];
  const newByDaily = new Map<string, { product: ParsedProduct; aiRepaired: boolean }[]>();

  for (const { decision, key } of resolved) {
    const dailyBusinessId = dailyIdByKey.get(key);
    if (!dailyBusinessId) continue;
    // 메모는 업체 카드 단위로 한 번만 반영한다(같은 업체의 여러 상품 줄에 같은 메모가 실려 온다).
    if (decision.memo && !memoByDaily.has(dailyBusinessId)) memoByDaily.set(dailyBusinessId, decision.memo);

    const { product } = decision;
    const existingId = decision.existingOrderItemId; // 나중에 실행하는 함수 안에서도 null이 아님을 유지하려고 값으로 꺼낸다
    if (decision.kind === 'update_line' && existingId) {
      recordChange(existingId, 'modified', { quantity: product.quantity, unit: product.unit });
      // 주문 수량이 미출고 수량보다 작아지면 미출고 수량도 맞춘다(필터가 맞을 때만 실행되는 조건부 갱신).
      updates.push(
        () => Promise.resolve(
          supabase.from('order_items').update({ unshipped_quantity: product.quantity }).eq('id', existingId).gt('unshipped_quantity', product.quantity),
        ),
      );
      updates.push(
        () => Promise.resolve(
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
              // true일 때만 쓴다: 마이그레이션 0055 전에도 일반 줄 입력이 막히지 않게 하고, 한 번 AI 보정이면 그 기록을 지우지 않는다.
              ...(decision.aiRepaired ? { ai_repaired: true } : {}),
            })
            .eq('id', existingId),
        ),
      );
    } else {
      const list = newByDaily.get(dailyBusinessId) ?? [];
      list.push({ product, aiRepaired: decision.aiRepaired === true });
      newByDaily.set(dailyBusinessId, list);
    }
  }

  if (memoByDaily.size > 0) {
    const { data: memoRows, error: memoError } = await supabase.from('daily_businesses').select('id, memo').in('id', [...memoByDaily.keys()]);
    if (memoError) throw new Error(`메모의 이전 값을 읽지 못했습니다: ${memoError.message}`);
    const beforeMemo = new Map((memoRows ?? []).map((r) => [r.id, r.memo]));
    for (const [dailyBusinessId, memo] of memoByDaily) {
      if (state.createdDailyIds.includes(dailyBusinessId)) continue; // 이번 입력이 만든 카드의 메모는 되돌릴 이전 값이 없다
      state.effects.memos.push({ dailyBusinessId, before: beforeMemo.get(dailyBusinessId) ?? null, after: memo });
    }
  }
  for (const [dailyBusinessId, memo] of memoByDaily) {
    updates.push(() => Promise.resolve(supabase.from('daily_businesses').update({ memo }).eq('id', dailyBusinessId)));
  }
  if (cancelPromise) updates.push(() => Promise.resolve(cancelPromise));

  const newRowGroups = await Promise.all(
    [...newByDaily].map(async ([dailyBusinessId, products]) => {
      const rows = [];
      for (const { product, aiRepaired } of products) {
        const { data: sequence, error: sequenceError } = await supabase.rpc('assign_product_sequence', { p_daily_business_id: dailyBusinessId });
        if (sequenceError || sequence === null) throw new Error(`상품 순번 발급 실패: ${sequenceError?.message ?? '응답 없음'}`);
        rows.push(
          newOrderItemRow({
            dailyBusinessId,
            sequence,
            product,
            sizeSpec: parseSizeSpec(product.sizeRequest, settings),
            aiRepaired,
            isFirstInputOfDay,
            userId,
          }),
        );
      }
      return rows;
    }),
  );
  const newRows = newRowGroups.flat();
  if (newRows.length > 0) {
    // 줄마다 열 조합이 달라도 빠진 열은 NULL이 아니라 DB 기본값을 쓰게 한다(newOrderItemRow가 같은 열을 주지만 이중으로 막는다).
    const { data: inserted, error } = await supabase.from('order_items').insert(newRows, { defaultToNull: false }).select('id, daily_business_id, product_name_raw, quantity, unit');
    if (error) throw new Error(`상품 저장 실패: ${error.message}`);
    for (const r of inserted ?? []) {
      state.effects.createdItems.push({ id: r.id, dailyBusinessId: r.daily_business_id, productName: r.product_name_raw, quantity: Number(r.quantity), unit: r.unit });
    }
  }
  state.itemsSaved = true;
  const productNames = [...new Set(resolved.map((r) => r.decision.product.productName))];
  // 기존 줄 수정·취소·메모는 10건씩 차례로 보낸다(오후 추가 입력은 수백 건이 되는데 쓰기는 8초 제한이 있고 다시 시도하지 않는다).
  // 여기서 실패해도 새 줄은 이미 저장됐으므로 메시지 기록·화면 갱신은 끝까지 하고, 마지막에 실패를 알린다.
  let partialError: string | null = null;
  try {
    partialError = firstResultError(await runInChunks(updates, 10));
    await registerNewProducts(supabase, productNames);
  } catch (e) {
    partialError ??= e instanceof Error ? e.message : String(e);
  }

  // 되돌리기용 기록(이 입력이 한 일). 마이그레이션 0066 전이거나 실패해도 저장된 주문은 그대로 두고 되돌리기만 못 한다.
  if (hasEffects(state.effects)) {
    const { error } = await supabase
      .from('order_input_batches')
      .insert({ order_date: orderDate, round, raw_text: rawText ?? null, effects: { ...state.effects, createdCardIds: state.createdDailyIds }, created_by: userId });
    if (error && !missingTable(error.message)) console.error('[commitOrderLines] order_input_batches insert failed', error.message);
  }

  // 메시지 기록은 주문이 모두 저장된 뒤에 남긴다. 기록은 보관용이라 실패해도 저장된 주문을 되돌리거나 다시 입력하게 하지 않는다.
  // (DB 규칙상 이 기록은 입력만 되고 지울 수 없어서, 앞에 남기면 실패한 확정의 기록을 정리할 수도 없다.)
  if (rawText) {
    const { error } = await supabase.from('kakao_message_log').insert({ order_date: orderDate, round, raw_text: rawText, created_by: userId });
    if (error) console.error('[commitOrderLines] message log insert failed', error.message);
  }

  revalidatePath('/dashboard');
  revalidatePath('/terminals');
  revalidatePath('/businesses');
  revalidatePath('/products');

  if (partialError) throw new Error(`주문 반영 중 일부 저장 실패: ${partialError}`);
}

// ─── 마지막 입력 되돌리기 ──────────────────────────────────────────────────
export interface LastOrderInput {
  id: string;
  createdAt: string;
  createdByName: string | null;
  round: OrderRound;
  summary: EffectsSummary;
}

// 그 날짜에서 아직 되돌리지 않은 가장 최근 입력(마지막 입력만 되돌릴 수 있다). 기록 테이블이 없거나(마이그레이션 0066 전) 읽지 못하면 null.
export async function getLastOrderInput(orderDate: string): Promise<LastOrderInput | null> {
  await requirePermission('orders:view');
  if (!isIsoDate(orderDate)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('order_input_batches')
    .select('id, round, effects, created_at, created_by')
    .eq('order_date', orderDate)
    .is('undone_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!missingTable(error.message)) console.error('[getLastOrderInput]', error.message);
    return null;
  }
  const effects = data ? parseEffects(data.effects) : null;
  if (!data || !effects) return null;
  let createdByName: string | null = null;
  if (data.created_by) {
    const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', data.created_by).maybeSingle();
    createdByName = profile?.display_name ?? null;
  }
  return { id: data.id, createdAt: data.created_at, createdByName, round: data.round === 2 ? 2 : 1, summary: summarizeEffects(effects) };
}

export type UndoResult = { ok: true; summary: EffectsSummary } | { ok: false; error: string; conflicts?: string[] };

// 마지막 입력을 되돌린다: 새로 만든 상품 줄은 "취소" 상태로, 수정·취소한 줄은 이전 값으로. 그 뒤에 바뀐 줄이 있으면 아무것도 바꾸지 않고 알린다.
export async function undoLastOrderInput(batchId: string): Promise<UndoResult> {
  const access = await requirePermission('orders:edit');
  const supabase = await createClient();
  try {
    const { data: batch, error: batchError } = await supabase.from('order_input_batches').select('id, order_date, effects, undone_at').eq('id', batchId).maybeSingle();
    if (batchError) return { ok: false, error: `입력 기록을 읽지 못했습니다: ${batchError.message}` };
    if (!batch) return { ok: false, error: '입력 기록을 찾을 수 없습니다. 화면을 새로고침해 주세요.' };
    if (batch.undone_at) return { ok: false, error: '이미 되돌린 입력입니다. 화면을 새로고침해 주세요.' };
    const effects = parseEffects(batch.effects);
    if (!effects) return { ok: false, error: '이 입력의 기록 형식을 읽을 수 없어 되돌릴 수 없습니다.' };

    const settings = await loadAppSettings(supabase);
    const dateError = editableDateError(batch.order_date, settings.allowPastOrderEdit, { allowTomorrow: true });
    if (dateError) return { ok: false, error: dateError };

    // 마지막 입력만 되돌린다: 이 날짜에서 아직 되돌리지 않은 더 최근 입력이 있으면 그것부터 되돌려야 한다.
    const { data: latest, error: latestError } = await supabase
      .from('order_input_batches')
      .select('id')
      .eq('order_date', batch.order_date)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) return { ok: false, error: `최근 입력을 확인하지 못했습니다: ${latestError.message}` };
    if (latest?.id !== batch.id) return { ok: false, error: '이 입력보다 나중에 입력한 것이 있습니다. 마지막 입력만 되돌릴 수 있습니다. 화면을 새로고침해 주세요.' };

    const itemIds = [...new Set([...effects.createdItems.map((c) => c.id), ...effects.changedItems.map((c) => c.id)])];
    const dailyIds = [...new Set(effects.memos.map((m) => m.dailyBusinessId))];
    const [itemsResult, memosResult] = await Promise.all([
      itemIds.length ? supabase.from('order_items').select('id, product_name_raw, quantity, unit, change_status, is_packed, unshipped_quantity').in('id', itemIds) : Promise.resolve({ data: [], error: null }),
      dailyIds.length ? supabase.from('daily_businesses').select('id, memo').in('id', dailyIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (itemsResult.error) return { ok: false, error: `상품을 읽지 못했습니다: ${itemsResult.error.message}` };
    if (memosResult.error) return { ok: false, error: `메모를 읽지 못했습니다: ${memosResult.error.message}` };
    const currentItems = new Map((itemsResult.data ?? []).map((r) => [r.id, { id: r.id, product_name_raw: r.product_name_raw, quantity: Number(r.quantity), unit: r.unit, change_status: r.change_status, is_packed: r.is_packed, unshipped_quantity: Number(r.unshipped_quantity ?? 0) }]));
    const currentMemos = new Map((memosResult.data ?? []).map((r) => [r.id, { dailyBusinessId: r.id, memo: r.memo }]));

    const plan = planUndo(effects, currentItems, currentMemos);
    if (plan.conflicts.length > 0) {
      return { ok: false, error: '그 뒤에 바뀐 상품이 있어 되돌리지 않았습니다. 아래 상품은 주문 목록에서 직접 고쳐 주세요.', conflicts: plan.conflicts };
    }

    // 실행: 모두 같은 결과로 다시 해도 되는 갱신이라, 중간에 실패해도 다시 누르면 이어서 끝난다.
    if (plan.cancelItemIds.length > 0) {
      const { error } = await supabase.from('order_items').update({ change_status: 'cancelled' }).in('id', plan.cancelItemIds);
      if (error) return { ok: false, error: `새 상품을 취소하지 못했습니다: ${error.message}` };
    }
    for (const r of plan.restoreItems) {
      const { error } = await supabase
        .from('order_items')
        .update({
          quantity: r.before.quantity,
          unit: r.before.unit,
          secondary_weight_kg: r.before.secondary_weight_kg,
          size_request: r.before.size_request,
          size_spec: r.before.size_spec as never,
          is_mulbong: r.before.is_mulbong,
          has_aerator: r.before.has_aerator,
          mulbong_box_count: r.before.mulbong_box_count,
          has_ice_pack: r.before.has_ice_pack,
          from_stock: r.before.from_stock,
          change_status: r.before.change_status as 'none' | 'new' | 'modified' | 'cancelled',
          needs_review: r.before.needs_review,
          review_reason: r.before.review_reason,
          unshipped_quantity: r.before.unshipped_quantity,
        })
        .eq('id', r.id);
      if (error) return { ok: false, error: `상품을 이전 값으로 돌리지 못했습니다(다시 누르면 이어서 합니다): ${error.message}` };
    }
    for (const m of plan.restoreMemos) {
      const { error } = await supabase.from('daily_businesses').update({ memo: m.memo }).eq('id', m.dailyBusinessId);
      if (error) return { ok: false, error: `메모를 이전 값으로 돌리지 못했습니다(다시 누르면 이어서 합니다): ${error.message}` };
    }

    const { error: markError } = await supabase.from('order_input_batches').update({ undone_at: new Date().toISOString(), undone_by: access.userId }).eq('id', batch.id).is('undone_at', null);
    if (markError) return { ok: false, error: `되돌림 표시를 남기지 못했습니다(다시 누르면 이어서 합니다): ${markError.message}` };

    revalidatePath('/dashboard');
    return { ok: true, summary: summarizeEffects(effects) };
  } catch (error) {
    if (isFrameworkSignal(error)) throw error;
    console.error('[undoLastOrderInput] failed', error);
    return { ok: false, error: '되돌리는 중 오류가 났습니다. 주문 목록을 확인하고 다시 시도해 주세요.' };
  }
}
