import { createClient } from '@/lib/supabase/server';
import { BusinessesClient } from './businesses-client';

export default async function BusinessesPage() {
  const supabase = await createClient();
  const [{ data: businesses, error: businessError }, { data: terminals }] = await Promise.all([
    supabase.from('businesses').select('id, name, terminal_id, notes, created_at, created_via, business_registration_no, representative_name').order('name'),
    supabase.from('terminals').select('id, name, fill_color, border_color').order('name'),
  ]);

  // 조회 오류(예: 아직 적용 안 된 마이그레이션의 컬럼)를 빈 목록으로 삼키면 "고객사가 사라진 것"처럼 보인다.
  if (businessError) throw new Error(`고객사 조회 실패(마이그레이션 0024 적용 필요): ${businessError.message}`);

  return <BusinessesClient businesses={businesses ?? []} terminals={terminals ?? []} />;
}
