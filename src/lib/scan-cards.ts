// 상차 현황의 업체 카드 조회(서버 전용): 그날 발급된 박스 라벨을 업체 카드별로 모아 "상차 몇 박스 / 전체 몇 박스"를 만든다.
// 상차 스캔 화면과 보내기 화면이 같이 쓴다.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import type { ScanCard } from '@/app/(dashboard)/scan/scan-client';
import { fetchAll, selectAll } from '@/lib/supabase/fetch-all';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { packageCounts } from '@/lib/scan-share-text';

export async function loadScanCards(supabase: SupabaseClient<Database>, orderDate: string): Promise<ScanCard[]> {
  const [{ data: dailies, error }, { data: businesses }, { data: terminals }] = await Promise.all([
    supabase.from('daily_businesses').select('id, business_id, terminal_id, business_number, round, sort_order, display_name, merge_groups').eq('order_date', orderDate).order('sort_order'),
    fetchAll((from, to) => supabase.from('businesses').select('id, name').order('id').range(from, to), '업체 조회 실패: ').then((data) => ({ data })),
    supabase.from('terminals').select('id, name'),
  ]);
  if (error) throw new Error(`상차 현황 조회 실패: ${error.message}`);
  const dailyRows = dailies ?? [];
  const dailyIds = dailyRows.map((d) => d.id);
  const { data: labels } = dailyIds.length
    ? await selectAll((from, to) => supabase.from('box_labels').select('daily_business_id, seq, loaded_at').in('daily_business_id', dailyIds).order('id').range(from, to), '라벨 조회 실패: ')
    : { data: [] };

  const businessName = new Map((businesses ?? []).map((b) => [b.id, b.name]));
  const terminalName = new Map((terminals ?? []).map((t) => [t.id, t.name]));
  const split = businessIdsInBothRounds(dailyRows.map((d) => ({ businessId: d.business_id, round: d.round })));
  return dailyRows.flatMap((d) => {
    const own = (labels ?? []).filter((l) => l.daily_business_id === d.id);
    if (own.length === 0) return []; // 라벨을 출력한 적 없는 업체는 상차 현황에 올리지 않는다
    return [
      {
        id: d.id,
        number: d.business_number,
        business: d.display_name ?? businessName.get(d.business_id) ?? '',
        roundLabel: split.has(d.business_id) ? roundLabel(d.round) : null,
        terminal: d.terminal_id ? terminalName.get(d.terminal_id) ?? '' : '',
        loaded: own.filter((l) => l.loaded_at).length,
        total: own.length,
        packages: packageCounts(own.map((l) => ({ seq: l.seq, loaded: !!l.loaded_at })), d.merge_groups),
      },
    ];
  });
}
