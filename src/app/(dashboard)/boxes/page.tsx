import { createClient } from '@/lib/supabase/server';
import { BoxesClient } from './boxes-client';

export default async function BoxesPage() {
  const supabase = await createClient();
  const { data: boxes } = await supabase
    .from('boxes')
    .select('id, name, notes, inner_width_cm, inner_depth_cm, inner_height_cm, is_mulbong_box, is_active')
    .order('name');

  return <BoxesClient boxes={boxes ?? []} />;
}
