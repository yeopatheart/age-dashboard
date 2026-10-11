import { createClient } from '@/lib/supabase/server';
import { TerminalsClient } from './terminals-client';

export default async function TerminalsPage() {
  const supabase = await createClient();
  const { data: terminals, error } = await supabase.from('terminals').select('id, name, created_at, created_via, fill_color, border_color').order('name');

  if (error) throw new Error(`터미널 조회 실패: ${error.message}`);

  return <TerminalsClient terminals={terminals ?? []} />;
}
