import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { Receipt } from 'lucide-react';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MigrationNotice } from '@/components/migration-notice';
import { todayKST } from '@/lib/order-date';
import { getPeriod, type Granularity } from '@/lib/report';
import { loadSalesRows } from '@/lib/settlement/server';
import { SettlementClient } from './settlement-client';

const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 정산: 출고가 끝난 주문을 판매내역으로 보여 주고 판매가·사업자 구분·입금 여부·메모를 입력한다.
// ?g=day|week|month(기본 day)와 ?d=YYYY-MM-DD(기준일, 기본 오늘, 미래는 오늘로 본다)로 기간을 정한다.
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ g?: string; d?: string }> }) {
  const accessCheck = requireMenu('settlement'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const { g, d } = await searchParams;
  const today = todayKST();
  const granularity: Granularity = g === 'week' || g === 'month' ? g : 'day';
  const anchor = d && isValidDate(d) && d <= today ? d : today;
  const period = getPeriod(granularity, anchor);
  const supabase = await createClient();

  const [, sales, sellers, inputsTable] = await Promise.all([
    accessCheck,
    rowsOrMissing(loadSalesRows(supabase, period.from, period.to)),
    rowsOrMissing(fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: ')),
    // 출고 완료 줄이 없는 기간에는 입력값 테이블을 조회하지 않으므로, 없는 마이그레이션을 한 번에 알려 주려고 존재만 따로 확인한다.
    rowsOrMissing(
      supabase
        .from('settlement_sales')
        .select('order_item_id')
        .limit(1)
        .then(({ error }) => {
          if (error) throw new Error(error.message);
          return [] as never[];
        }),
    ),
  ]);

  // 마이그레이션(0042 사업자, 0043 정산 입력값)을 적용하기 전에 배포되면 테이블이 없다. 운영 화면은 서버 오류 문구를 가려서 "에러"만 보이므로 안내를 대신 보여 준다.
  const missing = [sales.missing, sellers.missing, inputsTable.missing].filter((t): t is string => !!t);
  if (missing.length > 0) {
    return (
      <div className="ak-page">
        <AdminHeader icon={<Receipt size={20} />} title="정산" sub="출고가 끝난 주문이 판매내역으로 올라옵니다." />
        <MigrationNotice feature="정산" migrations={migrationsFor(missing)} />
      </div>
    );
  }

  // 기간을 옮기면 입력 중이던 값·선택을 새로 시작한다(key가 바뀌면 화면 상태가 초기화된다).
  return <SettlementClient key={`${granularity}-${anchor}`} rows={sales.rows} sellers={sellers.rows} granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} multiDay={period.from !== period.to} />;
}
