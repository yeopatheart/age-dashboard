import { createClient } from '@/lib/supabase/server';
import { ScanClient } from './scan-client';
import { requireMenu } from '@/lib/permissions/access';
import { todayKST } from '@/lib/order-date';
import { loadScanCards } from '@/lib/scan-cards';

// 상차 스캔 화면. 그날 발급된 박스 라벨을 업체 카드별·터미널별로 모아 "상차 몇 박스 / 전체 몇 박스"를 보여준다.
export default async function ScanPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const accessCheck = requireMenu('scan'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const { date } = await searchParams;
  const today = todayKST();
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const supabase = await createClient();

  const [, cards] = await Promise.all([accessCheck, loadScanCards(supabase, orderDate)]);

  return <ScanClient orderDate={orderDate} today={today} cards={cards} />;
}
