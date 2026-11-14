import { createClient } from '@/lib/supabase/server';
import { can, requireMenu } from '@/lib/permissions/access';
import { getPeriod, type Granularity } from '@/lib/report';
import { todayKST } from '@/lib/order-date';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { MigrationNotice } from '@/components/migration-notice';
import { buildPurchaseRows } from '@/lib/settlement/purchases';
import { loadSalesRows, loadSupplierPayments } from '@/lib/settlement/server';
import { bucketsOf } from '@/lib/reports/buckets';
import { groupReview, byCustomer as inputByCustomer, byProduct as inputByProduct, byTerminal as inputByTerminal, inputSummary, inputTrend, reviewReasons } from '@/lib/reports/input-quality';
import { groupLabels, labelSummary, labelTrend } from '@/lib/reports/label-quality';
import { loadInputLines, loadLabelRecs, loadOrderLines, loadPastes, loadPurchaseInputTimes, loadSalesInputTimes } from '@/lib/reports/ops-report-server';
import { completionTrend, inputLag, openPurchases, openSalesDays, payables, receivables } from '@/lib/reports/settle-close';
import { byCustomer, byProduct, byTerminal, groupUnshipped, reasonCounts, unshippedSummary, unshippedTrend } from '@/lib/reports/unshipped';
import { OpsReportClient, type OpsView } from './ops-report-client';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];
const OPEN_PURCHASE_LIMIT = 30;

// 운영 개선 리포트: 미출고, 주문 입력 품질, 라벨·상차 품질, 정산 마감(입력 완결률·수금·지급·입력 지연). 기간은 ?g=day|week|month(기본 월), ?date=기준일, 보기는 ?view=unshipped|input|label|settle.
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
  const currentView: OpsView = view === 'settle' ? (canSettle ? 'settle' : 'unshipped') : view === 'input' || view === 'label' ? view : 'unshipped';
  const supabase = await createClient();
  const base = { view: currentView, canSettle, granularity, anchor, today, period, unshipped: null, input: null, label: null, settle: null };

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
      />
    );
  }

  if (currentView === 'input') {
    // ai_repaired 열(마이그레이션 0055)이 없으면 운영 화면이 서버 오류로 죽으므로 안내를 보여 준다.
    const [inputLines, pastes] = await Promise.all([rowsOrMissing(loadInputLines(supabase, period.from, period.to)), loadPastes(supabase, period.from, period.to)]);
    if (inputLines.missing) return <MigrationNotice feature="주문 입력 품질 리포트" migrations={migrationsFor([inputLines.missing])} />;
    const lines = inputLines.rows;
    return (
      <OpsReportClient
        {...base}
        input={{
          summary: inputSummary(lines, pastes),
          trend: inputTrend(lines, pastes, buckets, granularity),
          reasons: reviewReasons(lines),
          products: groupReview(lines, inputByProduct),
          customers: groupReview(lines, inputByCustomer),
          terminals: groupReview(lines, inputByTerminal),
        }}
      />
    );
  }

  if (currentView === 'label') {
    const recs = await loadLabelRecs(supabase, period.from, period.to);
    return <OpsReportClient {...base} label={{ summary: labelSummary(recs), trend: labelTrend(recs, buckets, granularity), groups: groupLabels(recs) }} />;
  }

  const [sales, payments, purchaseTimes] = await Promise.all([
    rowsOrMissing(loadSalesRows(supabase, period.from, period.to)),
    loadSupplierPayments(supabase, period.from, period.to),
    rowsOrMissing(loadPurchaseInputTimes(supabase, period.from, period.to).then((m) => [...m])),
  ]);
  // 정산 마이그레이션(0042·0043)이 없으면 운영 화면이 서버 오류로 죽으므로 안내를 보여 준다.
  const missing = [sales.missing, purchaseTimes.missing].filter((x): x is string => !!x);
  if (missing.length > 0) return <MigrationNotice feature="정산 마감 리포트" migrations={migrationsFor(missing)} />;

  const salesTimes = await loadSalesInputTimes(supabase, sales.rows.filter((r) => r.price !== null).map((r) => r.itemId));
  const purchaseRows = buildPurchaseRows(sales.rows, payments ?? new Set());
  const purchaseTimeMap = new Map(purchaseTimes.rows);
  const saleLites = sales.rows.map((r) => ({ orderDate: r.orderDate, customer: r.customer, price: r.price, paid: r.paid }));
  const purchaseLites = purchaseRows.map((r) => ({ orderDate: r.orderDate, product: r.product, price: r.price, paid: r.paid, salesCount: r.salesCount }));
  const openPurchaseList = openPurchases(purchaseLites);

  return (
    <OpsReportClient
      {...base}
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
