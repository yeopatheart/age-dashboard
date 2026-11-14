import { createClient } from '@/lib/supabase/server';
import { PackingLogClient } from './packing-log-client';
import { requireMenu } from '@/lib/permissions/access';
import { loadPackingRows } from '@/lib/packing/load-rows';
import { todayKST } from '@/lib/order-date';

export default async function PackingLogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const accessCheck = requireMenu('packing'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const { date } = await searchParams;
  const today = todayKST();
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const supabase = await createClient();
  const [, { rows, boxes, settings }] = await Promise.all([accessCheck, loadPackingRows(supabase, orderDate)]);

  return <PackingLogClient orderDate={orderDate} today={today} allowPast={settings.allowPastOrderEdit} rows={rows} boxes={boxes} />;
}
