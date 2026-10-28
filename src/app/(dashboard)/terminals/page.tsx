import { createClient } from '@/lib/supabase/server';
import { TerminalsClient } from './terminals-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function TerminalsPage() {
  await requireMenu('terminals');
  const supabase = await createClient();
  const [{ data: terminals, error }, { data: businesses }] = await Promise.all([
    supabase.from('terminals').select('id, name, created_at, created_via, fill_color, border_color, is_separate').order('name'),
    supabase.from('businesses').select('terminal_id'),
  ]);

  if (error) throw new Error(`터미널 조회 실패: ${error.message}`);

  // 터미널마다 연결된 업체 수(표의 "업체 수" 열).
  const businessCount: Record<string, number> = {};
  for (const b of businesses ?? []) if (b.terminal_id) businessCount[b.terminal_id] = (businessCount[b.terminal_id] ?? 0) + 1;

  return <TerminalsClient terminals={terminals ?? []} businessCount={businessCount} />;
}
