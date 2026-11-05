import { Landmark } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MigrationNotice } from '@/components/migration-notice';
import { SellersClient } from './sellers-client';

// 사업자 관리: 판매·매입 건을 어느 사업자 명의로 처리하는지 구분할 때 쓰는 우리 쪽 사업자등록 목록.
export default async function SellersPage() {
  const accessCheck = requireMenu('sellers'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, sellers] = await Promise.all([
    accessCheck,
    rowsOrMissing(
      fetchAll(
        (from, to) =>
          supabase
            .from('seller_businesses')
            .select('id, name, representative_name, registration_no, opened_on, address, business_type, business_item, memo, created_at')
            .order('name')
            .order('id')
            .range(from, to),
        '사업자 조회 실패: ',
      ),
    ),
  ]);
  // 마이그레이션 0042를 적용하기 전에 배포되면 테이블이 없다. 운영 화면은 서버 오류 문구를 가려서 "에러"만 보이므로 안내를 대신 보여 준다.
  if (sellers.missing) {
    return (
      <div className="ak-page">
        <AdminHeader icon={<Landmark size={20} />} title="사업자 관리" sub="판매·매입 건을 어느 사업자 명의로 처리하는지 구분할 때 쓰는 우리 쪽 사업자등록 정보입니다." />
        <MigrationNotice feature="사업자 관리" migrations={migrationsFor([sellers.missing])} />
      </div>
    );
  }
  return <SellersClient sellers={sellers.rows} />;
}
