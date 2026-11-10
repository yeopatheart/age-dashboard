import { createClient } from '@/lib/supabase/server';
import { can, requireMenu } from '@/lib/permissions/access';
import { getPeriod, type Granularity } from '@/lib/report';
import { todayKST } from '@/lib/order-date';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { MigrationNotice } from '@/components/migration-notice';
import { buildPurchaseRows } from '@/lib/settlement/purchases';
import { loadSalesRows, loadStoredPurchases } from '@/lib/settlement/server';
import { bucketsOf } from '@/lib/reports/buckets';
import { loadOrderLines, loadPurchaseInputTimes, loadSalesInputTimes } from '@/lib/reports/ops-report-server';
import { completionTrend, inputLag, openPurchases, openSalesDays, payables, receivables } from '@/lib/reports/settle-close';
import { byCustomer, byProduct, byTerminal, groupUnshipped, reasonCounts, unshippedSummary, unshippedTrend } from '@/lib/reports/unshipped';
import { OpsReportClient, type OpsView } from './ops-report-client';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];
const OPEN_PURCHASE_LIMIT = 30;

// 운영 개선 리포트: 미출고 분석, 정산 마감(입력 완결률·수금·지급·입력 지연). 기간은 ?g=day|week|month(기본 월), ?date=기준일, 보기는 ?view=unshipped|settle.
// 정산 마감은 정산 테이블(RLS가 정산 보기 권한을 요구)을 읽고 금액이 나오므로 정산 보기 권한이 있을 때만 쓸 수 있다.
export default async function OpsReportPage({ searchParams }: { searchParams: Promise<{ g?: string; date?: string; view?: string }> }) {
  const access = await requireMenu('reports');
  const canSettle = can(access, 'settlement:view');
  const { g, date, view } = await searchParams;
  const today = todayKST();
  const granularity = GRANULARITIES.find((x) => x === g) ?? 'month';
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const period = getPeriod(granularity, anchor);
  const buckets = bucketsOf(granularity, period);
  const currentView: OpsView = view === 'settle' && canSettle ? 'settle' : 'unshipped';
  const supabase = await createClient();
  const base = { view: currentView, canSettle, granularity, anchor, today, period };

  if (currentView === 'unshipped') {
    const lines = await loadOrderLines(supabase, period.from, period.to);
    return (
      <OpsReportClient
        {...base}
        unshipped={{
          summary: unshippedSummary(lines),
          trend: unshippedTrend(lines, buckets, granularity),
          products: groupUnshipped(lines, byProduct),
          customers: groupUnshipped(lines, byCustomer),
          terminals: groupUnshipped(lines, byTerminal),
          reasons: reasonCounts(lines),
        }}
        settle={null}
      />
    );
  }

  const [sales, stored, purchaseTimes] = await Promise.all([
    rowsOrMissing(loadSalesRows(supabase, period.from, period.to)),
    rowsOrMissing(loadStoredPurchases(supabase, period.from, period.to)),
    rowsOrMissing(loadPurchaseInputTimes(supabase, period.from, period.to).then((m) => [...m])),
  ]);
  // 정산 마이그레이션(0042·0043·0044)이 없으면 운영 화면이 서버 오류로 죽으므로 안내를 보여 준다.
  const missing = [sales.missing, stored.missing, purchaseTimes.missing].filter((x): x is string => !!x);
  if (missing.length > 0) return <MigrationNotice feature="정산 마감 리포트" migrations={migrationsFor(missing)} />;

  const salesTimes = await loadSalesInputTimes(supabase, sales.rows.filter((r) => r.price !== null).map((r) => r.itemId));
  const purchaseRows = buildPurchaseRows(sales.rows, stored.rows);
  const purchaseTimeMap = new Map(purchaseTimes.rows);
  const saleLites = sales.rows.map((r) => ({ orderDate: r.orderDate, customer: r.customer, price: r.price, paid: r.paid }));
  const purchaseLites = purchaseRows.map((r) => ({ orderDate: r.orderDate, product: r.product, price: r.price, paid: r.paid, salesCount: r.salesCount }));
  const openPurchaseList = openPurchases(purchaseLites);

  return (
    <OpsReportClient
      {...base}
      unshipped={null}
      settle={{
        trend: completionTrend(saleLites, purchaseLites, buckets, granularity),
        openSales: openSalesDays(saleLites),
        openPurchases: openPurchaseList.slice(0, OPEN_PURCHASE_LIMIT),
        openPurchaseTotal: openPurchaseList.length,
        receivables: receivables(saleLites, today),
        payables: payables(purchaseLites),
        salesLag: inputLag(sales.rows.flatMap((r) => (r.price !== null && salesTimes.has(r.itemId) ? [{ orderDate: r.orderDate, updatedAt: salesTimes.get(r.itemId) as number }] : []))),
        purchaseLag: inputLag(purchaseRows.flatMap((r) => (r.price !== null && purchaseTimeMap.has(r.key) ? [{ orderDate: r.orderDate, updatedAt: purchaseTimeMap.get(r.key) as number }] : []))),
        salesLines: sales.rows.length,
      }}
    />
  );
}
