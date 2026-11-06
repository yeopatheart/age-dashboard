import { Receipt } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing, valueOrMissing } from '@/lib/supabase/missing-table';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MigrationNotice } from '@/components/migration-notice';
import { todayKST } from '@/lib/order-date';
import { getPeriod, type Granularity } from '@/lib/report';
import { loadSalesRows, loadStoredPurchases, loadSupplierDirectory } from '@/lib/settlement/server';
import { buildPurchaseRows, totalsOf } from '@/lib/settlement/purchases';
import { buildDailySeries } from '@/lib/settlement/chart';
import { PeriodBar } from './period-bar';
import { SettlementSection } from './settlement-section';
import { SettlementClient } from './settlement-client';
import { PurchasesClient } from './purchases-client';
import { ChartClient } from './chart-client';

const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 정산: 출고가 끝난 주문을 판매내역과 매입내역으로 보여 주고 가격·사업자 구분·입금 여부·메모를 입력한다. 그래프·매입내역·판매내역을 한 화면에 함께 보여 준다.
// ?g=day|week|month(기본 day), ?d=YYYY-MM-DD(기준일, 기본 오늘, 미래는 오늘로 본다)로 기간을 정한다. 세 구역이 같은 기간을 쓴다.
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ g?: string; d?: string }> }) {
  const accessCheck = requireMenu('settlement'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const { g, d } = await searchParams;
  const today = todayKST();
  const granularity: Granularity = g === 'week' || g === 'month' ? g : 'day';
  const anchor = d && isValidDate(d) && d <= today ? d : today;
  const period = getPeriod(granularity, anchor);
  const multiDay = period.from !== period.to;
  const supabase = await createClient();

  const header = <AdminHeader icon={<Receipt size={20} />} title="정산" sub="출고가 끝난 주문이 판매내역과 매입내역으로 올라옵니다. 가격, 사업자 구분, 입금 여부, 메모를 입력하세요. 입력하면 바로 저장됩니다." />;

  const [, sales, sellers, inputsTable, stored, directory] = await Promise.all([
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
    // 매입내역·그래프에 쓰는 값. 0044를 적용하기 전이면 두 구역만 안내를 보여 주고 판매내역은 계속 쓴다.
    rowsOrMissing(loadStoredPurchases(supabase, period.from, period.to)),
    valueOrMissing(loadSupplierDirectory(supabase)),
  ]);

  // 마이그레이션(0042 사업자, 0043 판매 입력값)을 적용하기 전에 배포되면 테이블이 없다. 운영 화면은 서버 오류 문구를 가려서 "에러"만 보이므로 안내를 대신 보여 준다.
  const missing = [sales.missing, sellers.missing, inputsTable.missing].filter((x): x is string => !!x);
  if (missing.length > 0) {
    return (
      <div className="ak-page">
        {header}
        <MigrationNotice feature="정산" migrations={migrationsFor(missing)} />
      </div>
    );
  }

  // 매입내역·그래프의 행(출고일 × 품목)은 판매내역에서 계산하고, 사용자가 입력해서 저장한 값을 붙인다.
  const purchaseMissing = [stored.missing, directory.missing].filter((x): x is string => !!x);
  const purchaseNotice = (feature: string) => <MigrationNotice feature={feature} migrations={migrationsFor(purchaseMissing)} />;
  const purchaseRows = purchaseMissing.length === 0 && directory.value ? buildPurchaseRows(sales.rows, stored.rows) : null;
  // 화면에 나온 품목의 매입처 연결만 보낸다(전체 상품의 연결을 다 보내지 않는다).
  const shown = new Set((purchaseRows ?? []).map((r) => r.product));
  const supplierIdsByProduct = Object.fromEntries(Object.entries(directory.value?.supplierIdsByProduct ?? {}).filter(([name]) => shown.has(name)));

  // 기간을 옮기면 입력 중이던 값·선택을 새로 시작한다(key가 바뀌면 화면 상태가 초기화된다).
  const key = `${granularity}-${anchor}`;
  return (
    <div className="ak-page">
      {header}
      <PeriodBar granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} />
      <div className="ak-split">
        <SettlementSection id="chart" title="그래프">
          {purchaseRows && directory.value ? (
            <ChartClient key={key} series={buildDailySeries(purchaseRows, period.from, period.to)} totals={totalsOf(purchaseRows)} periodLabel={period.label} />
          ) : (
            purchaseNotice('그래프')
          )}
        </SettlementSection>
        <SettlementSection id="purchases" title="매입내역">
          {purchaseRows && directory.value ? (
            <PurchasesClient key={key} rows={purchaseRows} sellers={sellers.rows} suppliers={directory.value.suppliers} supplierIdsByProduct={supplierIdsByProduct} multiDay={multiDay} />
          ) : (
            purchaseNotice('매입내역')
          )}
        </SettlementSection>
        <SettlementSection id="sales" title="판매내역">
          <SettlementClient key={key} rows={sales.rows} sellers={sellers.rows} multiDay={multiDay} from={period.from} to={period.to} />
        </SettlementSection>
      </div>
    </div>
  );
}
