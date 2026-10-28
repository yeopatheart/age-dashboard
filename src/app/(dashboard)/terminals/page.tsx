import { createClient } from '@/lib/supabase/server';
import { TerminalsClient } from './terminals-client';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';

export default async function TerminalsPage() {
  const accessCheck = requireMenu('terminals'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, { data: terminals, error }, businesses] = await Promise.all([
    accessCheck,
    supabase.from('terminals').select('id, name, created_at, created_via, fill_color, border_color, is_separate').order('name'),
    fetchAll((from, to) => supabase.from('businesses').select('terminal_id').order('id').range(from, to), '업체 조회 실패: '),
  ]);

  if (error) throw new Error(`터미널 조회 실패: ${error.message}`);

  // 터미널마다 연결된 업체 수(표의 "업체 수" 열).
  const businessCount: Record<string, number> = {};
  for (const b of businesses) if (b.terminal_id) businessCount[b.terminal_id] = (businessCount[b.terminal_id] ?? 0) + 1;

  return <TerminalsClient terminals={terminals ?? []} businessCount={businessCount} />;
}
