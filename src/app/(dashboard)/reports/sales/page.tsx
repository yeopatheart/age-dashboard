import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { getPeriod, type Granularity } from '@/lib/report';
import { todayKST } from '@/lib/order-date';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { MigrationNotice } from '@/components/migration-notice';
import { buildDailySeries } from '@/lib/settlement/chart';
import { buildProductGroups, buildSellerGroups } from '@/lib/settlement/chart-groups';
import { buildPurchaseRows, totalsOf } from '@/lib/settlement/purchases';
import { loadSalesRows, loadStoredPurchases } from '@/lib/settlement/server';
import { customerStats, marginOf, productStats, terminalStats, unpricedLines } from '@/lib/reports/sales-report';
import { SalesReportClient, type SalesView } from './sales-report-client';

// 이 탭은 년 단위를 두지 않는다(판매내역·매입내역 계산이 무거워 일·주·월로 충분하다).
const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];
const VIEWS: SalesView[] = ['trend', 'product', 'customer', 'terminal', 'seller'];

// 판매·수익 리포트: 정산 판매내역·매입내역 기준의 추이·품목별·업체별·터미널별·사업자별. 금액이 나오므로 리포트 보기에 더해 정산 보기 권한이 있어야 한다.
// 기간은 ?g=day|week|month(기본 월), ?date=기준일. 보기는 ?view=trend|product|customer|terminal|seller.
export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ g?: string; date?: string; view?: string }> }) {
  const reportsCheck = requireMenu('reports');
  const settlementCheck = requireMenu('settlement');
  const { g, date, view } = await searchParams;
  const today = todayKST();
  const granularity = GRANULARITIES.find((x) => x === g) ?? 'month';
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const period = getPeriod(granularity, anchor);
  const currentView = VIEWS.find((x) => x === view) ?? 'trend';

  const supabase = await createClient();
  const [, , sales, sellers, stored] = await Promise.all([
    reportsCheck,
    settlementCheck,
    rowsOrMissing(loadSalesRows(supabase, period.from, period.to)),
    rowsOrMissing(fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: ')),
    rowsOrMissing(loadStoredPurchases(supabase, period.from, period.to)),
  ]);

  // 정산 마이그레이션(사업자 0042, 판매 0043, 매입 0044)이 없으면 운영 화면이 서버 오류로 죽으므로 안내를 보여 준다.
  const missing = [sales.missing, sellers.missing, stored.missing].filter((x): x is string => !!x);
  if (missing.length > 0) return <MigrationNotice feature="판매·수익 리포트" migrations={migrationsFor(missing)} />;

  const purchaseRows = buildPurchaseRows(sales.rows, stored.rows);
  return (
    <SalesReportClient
      view={currentView}
      granularity={granularity}
      anchor={anchor}
      today={today}
      period={period}
      series={buildDailySeries(purchaseRows, period.from, period.to)}
      totals={totalsOf(purchaseRows)}
      margin={marginOf(purchaseRows).margin}
      unpricedLines={unpricedLines(sales.rows)}
      byProduct={buildProductGroups(purchaseRows)}
      bySeller={buildSellerGroups(sales.rows, purchaseRows, sellers.rows)}
      productStats={productStats(sales.rows, purchaseRows)}
      customerStats={customerStats(sales.rows)}
      terminalStats={terminalStats(sales.rows)}
    />
  );
}
