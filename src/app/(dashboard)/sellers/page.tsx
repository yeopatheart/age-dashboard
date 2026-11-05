import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { SellersClient } from './sellers-client';

// 사업자 관리: 판매·매입 건을 어느 사업자 명의로 처리하는지 구분할 때 쓰는 우리 쪽 사업자등록 목록.
export default async function SellersPage() {
  const accessCheck = requireMenu('sellers'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, sellers] = await Promise.all([
    accessCheck,
    fetchAll(
      (from, to) =>
        supabase
          .from('seller_businesses')
          .select('id, name, representative_name, registration_no, opened_on, address, business_type, business_item, memo, created_at')
          .order('name')
          .order('id')
          .range(from, to),
      '사업자 조회 실패(마이그레이션 0042 적용 필요): ',
    ),
  ]);
  return <SellersClient sellers={sellers} />;
}
