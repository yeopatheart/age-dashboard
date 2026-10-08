import { createClient } from '@/lib/supabase/server';
import { BusinessesClient } from './businesses-client';

export default async function BusinessesPage() {
  const supabase = await createClient();
  const [{ data: businesses }, { data: terminals }] = await Promise.all([
    supabase.from('businesses').select('id, name, terminal_id, notes, created_at, created_via').order('name'),
    supabase.from('terminals').select('id, name').order('name'),
  ]);

  return <BusinessesClient businesses={businesses ?? []} terminals={terminals ?? []} />;
}
