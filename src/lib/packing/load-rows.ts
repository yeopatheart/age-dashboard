import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { loadAppSettings } from '@/lib/settings-server';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { normalizeMergeGroups } from '@/lib/box-merge';
import { ensureRecommendations, getTodayModel, orderSignature, type LiveOrderItem, type RecommendationState } from '@/lib/packing/server';
import type { PackingBusiness } from '@/lib/packing/types';
import { fetchAll, mapChunks, selectAll } from '@/lib/supabase/fetch-all';
import { labelPrintStatus } from '@/lib/label-status';
import { excludedReason } from '@/lib/packing/excluded-items';
import { todayKST } from '@/lib/order-date';

// 박스 할당 화면(날짜의 모든 업체)과 주문 목록의 박스 할당 팝업(업체 한 곳)이 같은 데이터를 쓰도록 한 곳에서 읽는다.
// onlyDailyId를 주면 그 카드의 주문·제출 기록·추천·라벨만 읽는다(미제출이고 추천이 없으면 그 카드의 추천만 만든다).
export async function loadPackingRows(supabase: SupabaseClient<Database>, orderDate: string, onlyDailyId?: string) {
  // 1단계: 서로 의존하지 않는 조회를 한 번에 보낸다.
  const [{ data: dailies, error: dailyError }, businesses, { data: terminals }, { data: boxes }, products, settings] = await Promise.all([
    supabase.from('daily_businesses').select('id, business_id, business_number, round, terminal_id, display_name, merge_groups').eq('order_date', orderDate).order('sort_order'),
    fetchAll((from, to) => supabase.from('businesses').select('id, name').order('id').range(from, to), '업체 조회 실패: '),
    supabase.from('terminals').select('id, name, is_parcel'),
    supabase.from('boxes').select('id, name, is_active, inner_width_cm, inner_depth_cm, inner_height_cm, is_mulbong_box').order('name'),
    fetchAll((from, to) => supabase.from('products').select('name, needs_mulbong').order('id').range(from, to), '상품 조회 실패: '),
    loadAppSettings(supabase),
  ]);
  if (dailyError) throw new Error(`박스 할당 조회 실패: ${dailyError.message}`);
  // 1·2차 표기(roundLabel)는 그날 모든 카드를 봐야 정해지므로 카드 목록은 전부 읽고, 주문·제출·추천은 대상 카드만 읽는다.
  const allDailyRows = dailies ?? [];
  const dailyRows = onlyDailyId ? allDailyRows.filter((d) => d.id === onlyDailyId) : allDailyRows;
  const dailyIds = dailyRows.map((d) => d.id);

  // 2단계: 오늘 카드의 주문 줄과 제출 기록.
  const [{ data: items }, { data: records, error: recordError }] = dailyIds.length
    ? await Promise.all([
        selectAll((from, to) => supabase
          .from('order_items')
          .select('id, daily_business_id, product_sequence, product_name_raw, quantity, unit, measured_weight_kg, secondary_weight_kg, size_request, change_status, unshipped_quantity, is_mulbong, has_aerator')
          .in('daily_business_id', dailyIds)
          .order('product_sequence').order('id').range(from, to), '주문 줄 조회 실패: '),
        supabase.from('packing_records').select('id, daily_business_id, submitted_at, order_signature').in('daily_business_id', dailyIds),
      ])
    : [{ data: [] }, { data: [], error: null }];
  if (recordError) throw new Error(`박스 할당 조회 실패: ${recordError.message}`);

  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const terminalById = new Map((terminals ?? []).map((t) => [t.id, t.name]));
  const parcelTerminalIds = new Set((terminals ?? []).filter((t) => t.is_parcel).map((t) => t.id));
  const needsMulbong = new Map(products.map((p) => [p.name, p.needs_mulbong]));
  const recordByDaily = new Map((records ?? []).map((r) => [r.daily_business_id, r]));

  // 박스 추천: 미제출 업체의 현재 주문에 대한 추천이 없으면 오늘 모델로 만들어 저장한다.
  const boxByName = new Map((boxes ?? []).map((b) => [b.name, { id: b.id, name: b.name, is_mulbong_box: b.is_mulbong_box }]));
  const liveItemsOf = (dailyId: string): LiveOrderItem[] =>
    (items ?? [])
      .filter((i) => i.daily_business_id === dailyId && i.change_status !== 'cancelled' && Number(i.quantity) - Number(i.unshipped_quantity ?? 0) > 0)
      .map((i) => ({
        id: i.id,
        name: i.product_name_raw,
        unit: i.unit,
        quantity: Number(i.quantity) - Number(i.unshipped_quantity ?? 0),
        mulbongFlag: i.is_mulbong || (needsMulbong.get(i.product_name_raw) ?? false),
      }));

  // 3단계: 제출한 박스·상품 상세(박스 → 상품, 두 번 순서대로)와 추천 확인(필요할 때만 모델 로드)은 서로 무관해서 같이 보낸다.
  const recordIds = (records ?? []).map((r) => r.id);
  const loadPacked = async () => {
    const { data: packedBoxes } = recordIds.length
      ? await selectAll((from, to) => supabase.from('packing_boxes').select('id, record_id, box_id, position, box_name').in('record_id', recordIds).order('position').order('id').range(from, to), '박스 조회 실패: ')
      : { data: [] };
    const packedBoxIds = (packedBoxes ?? []).map((b) => b.id);
    const { data: packedItems } = packedBoxIds.length
      ? await selectAll((from, to) => supabase.from('packing_box_items').select('packing_box_id, order_item_id, quantity').in('packing_box_id', packedBoxIds).order('id').range(from, to), '박스 상품 조회 실패: ')
      : { data: [] };
    return { packedBoxes: packedBoxes ?? [], packedItems: packedItems ?? [] };
  };
  const [{ packedBoxes, packedItems }, recommendations] = await Promise.all([
    loadPacked(),
    dailyRows.length
      ? ensureRecommendations(
          supabase,
          () => getTodayModel(supabase, todayKST()),
          dailyRows.map((d) => ({ dailyBusinessId: d.id, items: liveItemsOf(d.id), submitted: recordByDaily.has(d.id) })),
          boxByName,
        )
      : Promise.resolve(new Map<string, RecommendationState>()),
  ]);

  // 라벨 출력 여부: 제출한 업체 카드의 박스 라벨 중 출력 이력이 있는 순번. 카드 안 라벨 영역과 같은 기준(box_labels + 'print' 이력)이다.
  const submittedDailyIds = dailyRows.filter((d) => recordByDaily.has(d.id)).map((d) => d.id);
  const labelRows = await mapChunks(submittedDailyIds, 100, async (chunk) => {
    const { data, error } = await supabase.from('box_labels').select('id, daily_business_id, seq').in('daily_business_id', chunk).limit(5000);
    if (error) throw new Error(`라벨 조회 실패: ${error.message}`);
    return data ?? [];
  });
  const printedLabelIds = new Set(
    await mapChunks(labelRows.map((l) => l.id), 100, async (chunk) => {
      const { data, error } = await supabase.from('box_label_events').select('label_id').eq('event', 'print').in('label_id', chunk).limit(5000);
      if (error) throw new Error(`라벨 출력 이력 조회 실패: ${error.message}`);
      return (data ?? []).map((e) => e.label_id);
    }),
  );
  const printedSeqsByDaily = new Map<string, number[]>();
  for (const l of labelRows) if (printedLabelIds.has(l.id)) printedSeqsByDaily.set(l.daily_business_id, [...(printedSeqsByDaily.get(l.daily_business_id) ?? []), l.seq]);

  const splitBusinessIds = businessIdsInBothRounds(allDailyRows.map((d) => ({ businessId: d.business_id, round: d.round })));
  const rows: PackingBusiness[] = dailyRows.map((d) => {
    const business = businessById.get(d.business_id);
    const record = recordByDaily.get(d.id);
    return {
      id: d.id,
      number: d.business_number,
      roundLabel: splitBusinessIds.has(d.business_id) ? roundLabel(d.round) : null,
      businessName: d.display_name ?? business?.name ?? '',
      terminal: d.terminal_id ? terminalById.get(d.terminal_id) ?? '' : '',
      parcel: !!d.terminal_id && parcelTerminalIds.has(d.terminal_id),
      items: (items ?? [])
        // 미출고 수량은 박스에 담을 대상이 아니므로 뺀다(전량 미출고면 상품 자체를 제외).
        .filter((i) => i.daily_business_id === d.id && i.change_status !== 'cancelled' && Number(i.quantity) - Number(i.unshipped_quantity ?? 0) > 0)
        .map((i) => ({
          id: i.id,
          name: i.product_name_raw,
          quantity: Number(i.quantity) - Number(i.unshipped_quantity ?? 0),
          unit: i.unit,
          weightKg: i.measured_weight_kg == null ? null : Number(i.measured_weight_kg),
          secondaryWeightKg: i.secondary_weight_kg == null ? null : Number(i.secondary_weight_kg),
          sizeRequest: i.size_request,
          needsMulbong: needsMulbong.get(i.product_name_raw) ?? false,
          aerator: i.has_aerator,
          orderMulbong: i.is_mulbong && !i.has_aerator,
        })),
      // 박스에 담을 대상이 아니라 위 목록에서 빠진 상품(수량 미정·전량 미출고). 화면이 안내한다.
      excludedItems: (items ?? []).flatMap((i) => {
        if (i.daily_business_id !== d.id || i.change_status === 'cancelled') return [];
        const reason = excludedReason(Number(i.quantity), i.unit, Number(i.unshipped_quantity ?? 0));
        return reason ? [{ name: i.product_name_raw, reason }] : [];
      }),
      cancelled: (items ?? []).some((i) => i.daily_business_id === d.id) && (items ?? []).filter((i) => i.daily_business_id === d.id).every((i) => i.change_status === 'cancelled'),
      mergeGroups: normalizeMergeGroups(d.merge_groups),
      recommendation: recommendations.get(d.id)?.current ?? null,
      // 택배 터미널과 미제출 업체는 라벨 표시를 하지 않는다.
      labelStatus: record && !(!!d.terminal_id && parcelTerminalIds.has(d.terminal_id)) ? labelPrintStatus(packedBoxes.filter((b) => b.record_id === record.id).length, printedSeqsByDaily.get(d.id) ?? []) : null,
      // 미제출: 추천을 만든 뒤 주문이 바뀜 / 제출: 제출한 뒤 주문이 바뀜 → 박스를 다시 확인해야 한다
      orderChanged: record
        ? !!record.order_signature && record.order_signature !== orderSignature(liveItemsOf(d.id))
        : recommendations.get(d.id)?.orderChanged ?? false,
      submitted: record
        ? {
            submittedAt: record.submitted_at,
            boxes: packedBoxes
              .filter((b) => b.record_id === record.id)
              .map((b) => ({
                boxId: b.box_id,
                boxName: b.box_name,
                items: (packedItems ?? [])
                  .filter((pi) => pi.packing_box_id === b.id && pi.order_item_id)
                  .map((pi) => ({ orderItemId: pi.order_item_id as string, quantity: Number(pi.quantity) })),
              })),
          }
        : null,
    };
  });

  return { rows, boxes: boxes ?? [], settings };
}
