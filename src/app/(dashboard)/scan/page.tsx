import { createClient } from '@/lib/supabase/server';
import { ScanClient, type ScanCard } from './scan-client';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// 상차 스캔 화면. 그날 발급된 박스 라벨을 업체 카드별·터미널별로 모아 "상차 몇 박스 / 전체 몇 박스"를 보여준다.
export default async function ScanPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const today = todayKST();
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const supabase = await createClient();

  const [{ data: dailies, error }, { data: businesses }, { data: terminals }] = await Promise.all([
    supabase.from('daily_businesses').select('id, business_id, terminal_id, business_number, round, sort_order').eq('order_date', orderDate).order('sort_order'),
    supabase.from('businesses').select('id, name'),
    supabase.from('terminals').select('id, name'),
  ]);
  if (error) throw new Error(`상차 현황 조회 실패: ${error.message}`);
  const dailyRows = dailies ?? [];
  const dailyIds = dailyRows.map((d) => d.id);
  const { data: labels } = dailyIds.length
    ? await supabase.from('box_labels').select('daily_business_id, loaded_at').in('daily_business_id', dailyIds)
    : { data: [] };

  const businessName = new Map((businesses ?? []).map((b) => [b.id, b.name]));
  const terminalName = new Map((terminals ?? []).map((t) => [t.id, t.name]));
  const cards: ScanCard[] = dailyRows.flatMap((d) => {
    const own = (labels ?? []).filter((l) => l.daily_business_id === d.id);
    if (own.length === 0) return []; // 라벨을 출력한 적 없는 업체는 상차 현황에 올리지 않는다
    return [
      {
        id: d.id,
        number: d.business_number,
        business: businessName.get(d.business_id) ?? '',
        terminal: d.terminal_id ? terminalName.get(d.terminal_id) ?? '' : '',
        loaded: own.filter((l) => l.loaded_at).length,
        total: own.length,
      },
    ];
  });

  return <ScanClient orderDate={orderDate} today={today} cards={cards} />;
}
