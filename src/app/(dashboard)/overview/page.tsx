import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { todayKST } from '@/lib/order-date';
import { buildOverviewCard, type LabelRow, type OverviewCardInput } from '@/lib/overview';
import { normalizeMergeGroups } from '@/lib/box-merge';
import { findChangedAfterPacking } from '@/lib/packing/server';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { OverviewClient } from './overview-client';

// 대시보드(진행 현황): 오늘 주문이 몇 곳이고 포장·박스·라벨·상차가 어디까지 왔는지. 읽기만 한다.
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const accessCheck = requireMenu('overview');
  const { date } = await searchParams;
  const today = todayKST();
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const supabase = await createClient();

  const [, { data: dailies, error }, businesses, { data: terminals }] = await Promise.all([
    accessCheck,
    supabase.from('daily_businesses').select('id, business_id, business_number, round, terminal_id, display_name, merge_groups').eq('order_date', orderDate).order('sort_order'),
    fetchAll((from, to) => supabase.from('businesses').select('id, name').order('id').range(from, to), '업체 조회 실패: '),
    supabase.from('terminals').select('id, name, is_separate, is_parcel'),
  ]);
  if (error) throw new Error(`현황 조회 실패: ${error.message}`);
  const dailyRows = dailies ?? [];
  const ids = dailyRows.map((d) => d.id);

  const [{ data: itemRows }, { data: recordRows }, { data: labelRows }, { data: recommendationRows }] = ids.length
    ? await Promise.all([
        supabase.from('order_items').select('id, daily_business_id, product_name_raw, quantity, unit, unshipped_quantity, is_packed, is_mulbong, change_status').in('daily_business_id', ids),
        supabase.from('packing_records').select('id, daily_business_id, order_signature').in('daily_business_id', ids),
        supabase.from('box_labels').select('daily_business_id, seq, loaded_at').in('daily_business_id', ids),
        supabase.from('packing_recommendations').select('daily_business_id, order_signature, created_at').in('daily_business_id', ids).order('created_at'),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const recordIds = (recordRows ?? []).map((r) => r.id);
  const { data: boxRows } = recordIds.length ? await supabase.from('packing_boxes').select('record_id').in('record_id', recordIds) : { data: [] };

  const dailyByRecord = new Map((recordRows ?? []).map((r) => [r.id, r.daily_business_id]));
  const submittedBoxes = new Map<string, number>((recordRows ?? []).map((r) => [r.daily_business_id, 0]));
  for (const b of boxRows ?? []) {
    const daily = dailyByRecord.get(b.record_id);
    if (daily) submittedBoxes.set(daily, (submittedBoxes.get(daily) ?? 0) + 1);
  }
  const labelsByDaily = new Map<string, LabelRow[]>();
  for (const l of labelRows ?? []) {
    const list = labelsByDaily.get(l.daily_business_id) ?? [];
    list.push({ seq: l.seq, loaded: !!l.loaded_at });
    labelsByDaily.set(l.daily_business_id, list);
  }
  // 박스 구성을 정한 뒤 주문이 바뀐 고객(주문 목록의 "박스 재확인"과 같은 기준). 경고 표시만 한다.
  const changedAfterPacking = findChangedAfterPacking(
    ids.map((id) => ({
      dailyBusinessId: id,
      items: (itemRows ?? [])
        .filter((r) => r.daily_business_id === id && r.change_status !== 'cancelled' && Number(r.quantity) - Number(r.unshipped_quantity ?? 0) > 0)
        .map((r) => ({ id: r.id, name: r.product_name_raw, unit: r.unit, quantity: Number(r.quantity) - Number(r.unshipped_quantity ?? 0), mulbongFlag: r.is_mulbong })),
    })),
    recordRows ?? [],
    recommendationRows ?? [],
  );

  const businessName = new Map(businesses.map((b) => [b.id, b.name]));
  const terminalById = new Map((terminals ?? []).map((t) => [t.id, t]));
  const split = businessIdsInBothRounds(dailyRows.map((d) => ({ businessId: d.business_id, round: d.round })));
  const cards = dailyRows.map((d, index) => {
    const terminal = d.terminal_id ? terminalById.get(d.terminal_id) : undefined;
    const input: OverviewCardInput = {
      id: d.id,
      number: index + 1,
      name: d.display_name ?? businessName.get(d.business_id) ?? '',
      terminal: terminal?.name ?? '',
      separate: terminal?.is_separate ?? false,
      parcel: terminal?.is_parcel ?? false,
      roundLabel: split.has(d.business_id) ? roundLabel(d.round) : null,
      items: (itemRows ?? [])
        .filter((i) => i.daily_business_id === d.id)
        .map((i) => ({ changeStatus: i.change_status, isPacked: i.is_packed, quantity: Number(i.quantity), unit: i.unit, unshippedQuantity: Number(i.unshipped_quantity ?? 0) })),
      submittedBoxes: submittedBoxes.has(d.id) ? submittedBoxes.get(d.id)! : null,
      labels: labelsByDaily.get(d.id) ?? [],
      mergeGroups: normalizeMergeGroups(d.merge_groups),
      packingChanged: changedAfterPacking.has(d.id),
    };
    return buildOverviewCard(input);
  });

  return <OverviewClient orderDate={orderDate} today={today} cards={cards} />;
}
