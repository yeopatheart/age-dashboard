import { createClient } from '@/lib/supabase/server';
import { TerminalsClient } from './terminals-client';

export default async function TerminalsPage() {
  const supabase = await createClient();
  const { data: terminals } = await supabase.from('terminals').select('id, name, created_at, created_via, fill_color, border_color').order('name');

  return <TerminalsClient terminals={terminals ?? []} />;
}
