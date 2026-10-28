import { createClient } from '@/lib/supabase/server';
import { BusinessesClient } from './businesses-client';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';

export default async function BusinessesPage() {
  const accessCheck = requireMenu('businesses'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, businesses, { data: terminals }] = await Promise.all([
    accessCheck,
    // 1000개를 넘을 수 있어 페이지로 나눠 모두 읽는다. 조회 오류(예: 아직 적용 안 된 마이그레이션의 컬럼)를 빈 목록으로 삼키면 "고객사가 사라진 것"처럼 보이므로 던진다.
    fetchAll((from, to) => supabase.from('businesses').select('id, name, terminal_id, notes, created_at, created_via, business_registration_no, representative_name').order('name').order('id').range(from, to), '고객사 조회 실패(마이그레이션 0024 적용 필요): '),
    supabase.from('terminals').select('id, name, fill_color, border_color').order('name'),
  ]);

  return <BusinessesClient businesses={businesses} terminals={terminals ?? []} />;
}
