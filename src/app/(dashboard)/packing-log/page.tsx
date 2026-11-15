import { createClient } from '@/lib/supabase/server';
import { PackingLogClient } from './packing-log-client';
import { requireMenu } from '@/lib/permissions/access';
import { loadPackingRows } from '@/lib/packing/load-rows';
import { todayKST, tomorrowKST } from '@/lib/order-date';
import { loadLabelConfirmMode } from '@/lib/labels/server';

export default async function PackingLogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const accessCheck = requireMenu('packing'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const { date } = await searchParams;
  const today = todayKST();
  const tomorrow = tomorrowKST(); // 박스 할당·라벨 출력은 내일 주문까지 미리 할 수 있다
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= tomorrow ? date : today;
  const supabase = await createClient();
  const [, { rows, boxes, settings }, confirmMode] = await Promise.all([accessCheck, loadPackingRows(supabase, orderDate), loadLabelConfirmMode(supabase)]);

  return <PackingLogClient orderDate={orderDate} today={today} tomorrow={tomorrow} allowPast={settings.allowPastOrderEdit} rows={rows} boxes={boxes} labelConfirmMode={confirmMode} />;
}
