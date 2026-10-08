'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { parseKakaoMessage, normalizeUnit, type ParsedBusinessLine, type ParsedProduct } from '@/lib/kakao-parser';
import { repairFailedLine } from '@/lib/kakao-ai-repair';
import { findClosestMatch } from '@/lib/fuzzy-match';
import { findOrCreateBusiness, findOrCreateDailyBusiness } from '@/lib/business-lookup';

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
  isFirst: boolean;
}

// 날짜별 카카오 메시지 입력 이력. 해당 날짜의 첫 로그(시간순)를 최초주문, 이후를 업데이트로
// 구분한다 — 메시지 내용이 아니라 그날 몇 번째로 들어왔는지로만 판단한다.
export async function getOrderHistory(orderDate: string): Promise<OrderHistoryEntry[]> {
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from('kakao_message_log')
    .select('id, raw_text, created_at, created_by')
    .eq('order_date', orderDate)
    .order('created_at', { ascending: true });

  const creatorIds = [...new Set((logs ?? []).map((log) => log.created_by).filter((id): id is string => id != null))];
  const { data: profiles } = creatorIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', creatorIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  return (logs ?? []).map((log, index) => ({
    id: log.id,
    rawText: log.raw_text,
    createdAt: log.created_at,
    createdByName: log.created_by ? nameById.get(log.created_by) ?? null : null,
    isFirst: index === 0,
  }));
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
  source: 'regex' | 'ai';
  // true면 확정할 수 없다(수량 없음, 취소 대상 없음) — 카톡 메시지를 고쳐서 다시 분석해야 한다.
  blocking: boolean;
  memo?: string;
  normalizedFrom?: string;
  // 등록된 적 없는 터미널/업체 — 확정하면 주문입력 출처로 자동 등록된다.
  isNewTerminal: boolean;
  isNewBusiness: boolean;
}

// 읽기 전용: 붙여넣은 텍스트를 파싱하고, 각 줄의 업체명을 업체 카탈로그 전체와 대조해서
// 신규/업데이트를 줄 단위로 제안한다. 아무것도 쓰지 않는다 — 확정은 commitOrderLines가 한다.
export async function suggestOrderLines(rawText: string, orderDate: string): Promise<SuggestedLine[]> {
  const supabase = await createClient();
  const parsedLines = parseKakaoMessage(rawText);

  const { data: allBusinesses } = await supabase.from('businesses').select('id, name');
  const businessList = allBusinesses ?? [];
  const { data: registeredTerminals } = await supabase.from('terminals').select('name');
  const terminalNameSet = new Set((registeredTerminals ?? []).map((t) => t.name));

  // 3분할 자체가 깨진 줄만 골라 AI에게 재구성을 맡긴다 — 실패해도(키 미설정 포함) null이
  // 돌아올 뿐이라 원래 정규식 결과(빈 상품 목록 + needsReview)가 그대로 쓰인다.
  const needsAiRepair = (line: ParsedBusinessLine) =>
    line.products.length === 0 && line.reviewReason === LINE_SPLIT_FAILURE_REASON;

  let resolvedLines: Array<{ line: ParsedBusinessLine; source: 'regex' | 'ai' }>;
  if (parsedLines.some(needsAiRepair)) {
    const { data: allTerminals } = await supabase.from('terminals').select('name');
    const terminalNames = (allTerminals ?? []).map((t) => t.name);
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

  const { data: dailyBusinesses } = await supabase
    .from('daily_businesses')
    .select('id, business_id')
    .eq('order_date', orderDate);
  const dailyRows = dailyBusinesses ?? [];
  const dailyIdByBusinessId = new Map(dailyRows.map((d) => [d.business_id, d.id]));

  const dailyBusinessIds = dailyRows.map((d) => d.id);
  const { data: existingItems } =
    dailyBusinessIds.length > 0
      ? await supabase
          .from('order_items')
          .select('id, daily_business_id, product_name_raw, quantity, unit, secondary_weight_kg, size_request, is_mulbong, mulbong_box_count, has_ice_pack, from_stock, change_status')
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
    const exact = businessList.find((b) => b.name === line.businessName);
    const matched = exact ?? findClosestMatch(line.businessName, businessList, (b) => b.name);
    const catalogBusinessId = matched?.id ?? null;
    const dailyBusinessId = catalogBusinessId ? dailyIdByBusinessId.get(catalogBusinessId) ?? null : null;
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
        });
      });
      continue;
    }

    line.products.forEach((product, idx) => {
      const existing = existingItems.find((i) => i.product_name_raw === product.productName);
      const common = { ...base, key: `${line.raw}__${idx}`, product, normalizedFrom: product.normalizedFrom };

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
          (existing.mulbong_box_count ?? null) === (product.mulbongBoxCount ?? null) &&
          existing.has_ice_pack === product.hasIcePack &&
          existing.from_stock === product.fromStock;
        kind = same ? 'no_change' : 'update_line';
        existingOrderItemId = existing.id;
      } else {
        kind = 'new_line';
      }

      // 수량이 없는 상품은 0으로 저장되면 안 되므로 확정 자체를 막는다(카톡 메시지를 고쳐서 다시 분석).
      const missingQuantity = product.quantity <= 0;
      suggestions.push({
        ...common,
        kind,
        existingOrderItemId,
        // 같은 줄의 다른 상품 하나가 문제라고 정상 상품까지 확인 필요로 만들지 않는다 — 상품 단위로만
        // 판단한다. 단, AI가 재구성한 줄은 모든 상품이 항상 사람 확인 대상이다.
        needsReview: product.needsReview || missingQuantity || source === 'ai',
        blocking: missingQuantity,
        reviewReason: product.reviewReason ?? (missingQuantity ? '수량을 찾지 못함' : source === 'ai' ? line.reviewReason : undefined),
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

// 사람이 확인 화면에서 확정한 대로 실제로 반영한다. 업체번호/상품순서는 여기서 처음이자
// 한 번만 assign_*_number RPC로 발급한다(append-only, 재사용 없음).
export async function commitOrderLines(orderDate: string, decisions: LineDecision[], rawText?: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? null;

  // 그날 첫 입력(로그가 아직 없음)으로 들어오는 상품은 "최초주문"(none), 이후 입력으로 새로 들어오는
  // 상품은 "추가됨"(new)으로 구분한다 — 대시보드에서 오전 최초 주문과 이후 추가분을 한눈에 가른다.
  let isFirstInputOfDay = false;
  if (rawText) {
    const { count } = await supabase
      .from('kakao_message_log')
      .select('id', { count: 'exact', head: true })
      .eq('order_date', orderDate);
    isFirstInputOfDay = (count ?? 0) === 0;
    await supabase.from('kakao_message_log').insert({ order_date: orderDate, raw_text: rawText, created_by: userId });
  }

  // 같은 업체가 한 번의 붙여넣기에 여러 줄로 나올 수 있다(업체당 상품 여러 개). 줄마다 매번
  // insert를 시도하면 두 번째 줄부터 businesses.name unique 제약이나 daily_businesses의
  // (order_date, business_id) unique 제약에 걸려 조용히 실패하므로, 이번 커밋 안에서
  // 새로 만든 id는 캐시해서 재사용한다.
  const businessIdCache = new Map<string, string>();
  const dailyBusinessIdCache = new Map<string, string>();
  const terminalIdCache = new Map<string, string | null>();
  const memoSaved = new Set<string>();

  // 등록되지 않은 터미널이면 주문입력 출처로 자동 등록한다.
  const findOrCreateTerminal = async (name: string): Promise<string | null> => {
    if (!name) return null;
    if (terminalIdCache.has(name)) return terminalIdCache.get(name) ?? null;
    const { data: existing } = await supabase.from('terminals').select('id').eq('name', name).maybeSingle();
    let id = existing?.id ?? null;
    if (!id) {
      const { data: created } = await supabase
        .from('terminals')
        .insert({ name, created_via: 'order' })
        .select('id')
        .single();
      id = created?.id ?? null;
    }
    terminalIdCache.set(name, id);
    return id;
  };

  for (const decision of decisions) {
    if (decision.kind === 'no_change') continue;
    if (decision.kind === 'cancel_line') {
      if (decision.existingOrderItemId) {
        await supabase.from('order_items').update({ change_status: 'cancelled' }).eq('id', decision.existingOrderItemId);
      }
      continue;
    }
    const terminalId = await findOrCreateTerminal(decision.terminalName);
    let businessId = decision.matchedBusinessId ?? businessIdCache.get(decision.businessNameRaw) ?? null;

    if (!businessId) {
      businessId = await findOrCreateBusiness(supabase, decision.businessNameRaw, terminalId, 'order');
      if (!businessId) continue;
      businessIdCache.set(decision.businessNameRaw, businessId);
    }

    let dailyBusinessId = dailyBusinessIdCache.get(businessId) ?? null;

    if (!dailyBusinessId) {
      dailyBusinessId = await findOrCreateDailyBusiness(supabase, orderDate, businessId);
    }

    if (!dailyBusinessId) continue;
    dailyBusinessIdCache.set(businessId, dailyBusinessId);

    // 메모는 업체 카드 단위로 한 번만 반영한다(같은 업체의 여러 상품 줄에 같은 메모가 실려 온다).
    if (decision.memo && !memoSaved.has(dailyBusinessId)) {
      memoSaved.add(dailyBusinessId);
      await supabase.from('daily_businesses').update({ memo: decision.memo }).eq('id', dailyBusinessId);
    }

    const { product } = decision;

    if (decision.kind === 'update_line' && decision.existingOrderItemId) {
      await supabase
        .from('order_items')
        .update({
          quantity: product.quantity,
          unit: product.unit,
          secondary_weight_kg: product.secondaryWeightKg,
          size_request: product.sizeRequest,
          is_mulbong: product.isMulbong,
          mulbong_box_count: product.mulbongBoxCount,
          has_ice_pack: product.hasIcePack,
          from_stock: product.fromStock,
          change_status: 'modified',
          needs_review: product.needsReview,
          review_reason: product.reviewReason ?? null,
        })
        .eq('id', decision.existingOrderItemId);
    } else {
      const { data: sequence } = await supabase.rpc('assign_product_sequence', {
        p_daily_business_id: dailyBusinessId,
      });
      await supabase.from('order_items').insert({
        daily_business_id: dailyBusinessId,
        product_sequence: sequence ?? 0,
        product_name_raw: product.productName,
        quantity: product.quantity,
        unit: product.unit,
        secondary_weight_kg: product.secondaryWeightKg,
        size_request: product.sizeRequest,
        is_mulbong: product.isMulbong,
        mulbong_box_count: product.mulbongBoxCount,
        has_ice_pack: product.hasIcePack,
        from_stock: product.fromStock,
        change_status: isFirstInputOfDay ? 'none' : 'new',
        needs_review: product.needsReview,
        review_reason: product.reviewReason ?? null,
        created_by: userId,
      });
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/terminals');
  revalidatePath('/businesses');
}
