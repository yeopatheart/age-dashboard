// 상차 현황의 업체 카드 조회(서버 전용): 그날 발급된 박스 라벨을 업체 카드별로 모아 "상차 몇 박스 / 전체 몇 박스"를 만든다.
// 상차 스캔 화면과 보내기 화면이 같이 쓴다.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import type { ScanCard } from '@/app/(dashboard)/scan/scan-client';
import { fetchAll, selectAll } from '@/lib/supabase/fetch-all';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { packageCounts } from '@/lib/scan-share-text';
import { cardBoxes, loadSubmittedBoxCounts } from '@/lib/scan-boxes';
import { cancelledCardIds } from '@/lib/card-cancelled';

export async function loadScanCards(supabase: SupabaseClient<Database>, orderDate: string): Promise<ScanCard[]> {
  const [{ data: dailies, error }, { data: businesses }, { data: terminals }] = await Promise.all([
    supabase.from('daily_businesses').select('id, business_id, terminal_id, business_number, round, sort_order, display_name, merge_groups, box_link_id').eq('order_date', orderDate).order('sort_order'),
    fetchAll((from, to) => supabase.from('businesses').select('id, name').order('id').range(from, to), '업체 조회 실패: ').then((data) => ({ data })),
    supabase.from('terminals').select('id, name'),
  ]);
  if (error) throw new Error(`상차 현황 조회 실패: ${error.message}`);
  const dailyRows = dailies ?? [];
  const dailyIds = dailyRows.map((d) => d.id);
  const { data: labels } = dailyIds.length
    ? await selectAll((from, to) => supabase.from('box_labels').select('daily_business_id, seq, loaded_at').in('daily_business_id', dailyIds).order('id').range(from, to), '라벨 조회 실패: ')
    : { data: [] };

  // 라벨을 낸 뒤 주문이 모두 취소된 업체는 스캔해도 상차되지 않으므로(scanBarcode) 현황·퀵기사 글의 "미상차"에 올리지 않는다. 이미 상차된 박스가 있으면 실제로 실린 것이라 남긴다.
  const labeledIds = [...new Set((labels ?? []).map((l) => l.daily_business_id))];
  const cancelled = await cancelledCardIds(supabase, labeledIds);
  const submittedBoxes = await loadSubmittedBoxCounts(supabase, dailyIds); // 전체 박스 수는 제출한 박스 수 기준이다(라벨 행 수가 아니라)
  const businessName = new Map((businesses ?? []).map((b) => [b.id, b.name]));
  const terminalName = new Map((terminals ?? []).map((t) => [t.id, t.name]));
  const split = businessIdsInBothRounds(dailyRows.map((d) => ({ businessId: d.business_id, round: d.round })));
  return dailyRows.flatMap((d) => {
    const own = (labels ?? []).filter((l) => l.daily_business_id === d.id);
    if (own.length === 0) return []; // 라벨을 출력한 적 없는 업체는 상차 현황에 올리지 않는다
    if (cancelled.has(d.id) && !own.some((l) => l.loaded_at)) return []; // 주문이 모두 취소됐고 상차된 박스도 없는 업체
    const boxes = cardBoxes(own, submittedBoxes.get(d.id) ?? null);
    return [
      {
        id: d.id,
        number: d.business_number,
        business: d.display_name ?? businessName.get(d.business_id) ?? '',
        roundLabel: split.has(d.business_id) ? roundLabel(d.round) : null,
        terminal: d.terminal_id ? terminalName.get(d.terminal_id) ?? '' : '',
        loaded: boxes.filter((b) => b.loaded).length,
        total: boxes.length,
        packages: packageCounts(boxes, d.merge_groups),
        linkId: d.box_link_id,
      },
    ];
  });
}
