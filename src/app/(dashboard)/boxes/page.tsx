import { createClient } from '@/lib/supabase/server';
import { BoxesClient } from './boxes-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function BoxesPage() {
  await requireMenu('boxes');
  const supabase = await createClient();
  const { data: boxes } = await supabase
    .from('boxes')
    .select('id, name, notes, inner_width_cm, inner_depth_cm, inner_height_cm, is_mulbong_box, is_active')
    .order('name');

  return <BoxesClient boxes={boxes ?? []} />;
}
