import { createClient } from '@/lib/supabase/server';
import { BoxesClient } from './boxes-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function BoxesPage() {
  const accessCheck = requireMenu('boxes'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, { data: boxes }] = await Promise.all([
    accessCheck,
    supabase.from('boxes').select('id, name, notes, inner_width_cm, inner_depth_cm, inner_height_cm, is_mulbong_box, is_active').order('name'),
  ]);

  return <BoxesClient boxes={boxes ?? []} />;
}
