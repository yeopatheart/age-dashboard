import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { ensureRecommendations, getTodayModel, orderSignature, type LiveOrderItem, type RecommendationState } from '@/lib/packing/server';
import { PackingLogClient, type PackingBusiness } from './packing-log-client';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

export default async function PackingLogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const today = todayKST();
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const supabase = await createClient();

  const { data: dailies, error: dailyError } = await supabase
    .from('daily_businesses')
    .select('id, business_id, business_number, round, terminal_id')
    .eq('order_date', orderDate)
    .order('sort_order');
  if (dailyError) throw new Error(`박스 기록 조회 실패: ${dailyError.message}`);
  const dailyRows = dailies ?? [];
  const dailyIds = dailyRows.map((d) => d.id);

  const [{ data: businesses }, { data: terminals }, { data: items }, { data: boxes }, { data: records, error: recordError }, { data: products }] =
    await Promise.all([
      supabase.from('businesses').select('id, name'),
      supabase.from('terminals').select('id, name'),
      dailyIds.length
        ? supabase
            .from('order_items')
            .select('id, daily_business_id, product_sequence, product_name_raw, quantity, unit, measured_weight_kg, secondary_weight_kg, size_request, change_status, unshipped_quantity, is_mulbong')
            .in('daily_business_id', dailyIds)
            .order('product_sequence')
        : Promise.resolve({ data: [] }),
      supabase
        .from('boxes')
        .select('id, name, is_active, inner_width_cm, inner_depth_cm, inner_height_cm, is_mulbong_box')
        .order('name'),
      dailyIds.length
        ? supabase.from('packing_records').select('id, daily_business_id, submitted_at, order_signature').in('daily_business_id', dailyIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('products').select('name, needs_mulbong'),
    ]);
  const settings = await loadAppSettings(supabase);
  if (recordError) throw new Error(`박스 기록 조회 실패: ${recordError.message}`);

  const recordIds = (records ?? []).map((r) => r.id);
  const { data: packedBoxes } = recordIds.length
    ? await supabase.from('packing_boxes').select('id, record_id, box_id, position, box_name').in('record_id', recordIds).order('position')
    : { data: [] };
  const packedBoxIds = (packedBoxes ?? []).map((b) => b.id);
  const { data: packedItems } = packedBoxIds.length
    ? await supabase.from('packing_box_items').select('packing_box_id, order_item_id, quantity').in('packing_box_id', packedBoxIds)
    : { data: [] };

  const businessById = new Map((businesses ?? []).map((b) => [b.id, b]));
  const terminalById = new Map((terminals ?? []).map((t) => [t.id, t.name]));
  const needsMulbong = new Map((products ?? []).map((p) => [p.name, p.needs_mulbong]));
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
  const model = dailyRows.length ? await getTodayModel(supabase, todayKST()) : null;
  const recommendations = model
    ? await ensureRecommendations(
        supabase,
        model,
        dailyRows.map((d) => ({ dailyBusinessId: d.id, items: liveItemsOf(d.id), submitted: recordByDaily.has(d.id) })),
        boxByName,
      )
    : new Map<string, RecommendationState>();

  const splitBusinessIds = businessIdsInBothRounds(dailyRows.map((d) => ({ businessId: d.business_id, round: d.round })));
  const rows: PackingBusiness[] = dailyRows.map((d) => {
    const business = businessById.get(d.business_id);
    const record = recordByDaily.get(d.id);
    return {
      id: d.id,
      number: d.business_number,
      roundLabel: splitBusinessIds.has(d.business_id) ? roundLabel(d.round) : null,
      businessName: business?.name ?? '',
      terminal: d.terminal_id ? terminalById.get(d.terminal_id) ?? '' : '',
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
        })),
      recommendation: recommendations.get(d.id)?.current ?? null,
      // 미제출: 추천을 만든 뒤 주문이 바뀜 / 제출: 제출한 뒤 주문이 바뀜 → 박스를 다시 확인해야 한다
      orderChanged: record
        ? !!record.order_signature && record.order_signature !== orderSignature(liveItemsOf(d.id))
        : recommendations.get(d.id)?.orderChanged ?? false,
      submitted: record
        ? {
            submittedAt: record.submitted_at,
            boxes: (packedBoxes ?? [])
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

  return <PackingLogClient orderDate={orderDate} today={today} allowPast={settings.allowPastOrderEdit} rows={rows} boxes={boxes ?? []} />;
}
