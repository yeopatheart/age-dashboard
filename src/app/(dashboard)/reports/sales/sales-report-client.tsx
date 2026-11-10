'use client';
import '@/components/admin/admin.css';
import { useRouter } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { PeriodNav } from '@/components/date-nav';
import { Segmented } from '@/components/segmented';
import { VIZ_CSS } from '@/components/viz/viz-css';
import { GRANULARITY_LABEL, type Granularity } from '@/lib/report';
import type { DayPoint } from '@/lib/settlement/chart';
import type { GroupPoint } from '@/lib/settlement/chart-groups';
import type { PurchaseTotals } from '@/lib/settlement/purchases';
import type { CustomerStat, ProductStat, TerminalStat } from '@/lib/reports/sales-report';
import { CustomerView } from './customer-view';
import { GroupChart } from './group-chart';
import { ProductView } from './product-view';
import { TerminalView } from './terminal-view';
import { TrendView } from './trend-view';

export type SalesView = 'trend' | 'product' | 'customer' | 'terminal' | 'seller';
const VIEW_LABEL: Record<SalesView, string> = { trend: '추이', product: '품목별', customer: '업체별', terminal: '터미널별', seller: '사업자별' };
const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

export interface SalesReportProps {
  view: SalesView;
  granularity: Granularity;
  anchor: string;
  today: string;
  period: { from: string; to: string; label: string };
  series: DayPoint[];
  totals: PurchaseTotals;
  margin: number | null;
  unpricedLines: number;
  byProduct: GroupPoint[];
  bySeller: GroupPoint[];
  productStats: ProductStat[];
  customerStats: CustomerStat[];
  terminalStats: TerminalStat[];
}

export function SalesReportClient(props: SalesReportProps) {
  const { view, granularity, anchor, today, period } = props;
  const router = useRouter();
  const go = (next: { g?: Granularity; date?: string; view?: SalesView }) =>
    router.push(`/reports/sales?g=${next.g ?? granularity}&date=${next.date ?? anchor}&view=${next.view ?? view}`);
  const filenameKey = `${period.from}_${period.to}`;

  return (
    <div className="sr-root viz-root">
      <div className="page-header">
        <div className="page-header-icon"><TrendingUp size={20} /></div>
        <div>
          <h1 className="page-title">판매·수익 리포트</h1>
          <p className="page-sub">정산의 판매내역·매입내역을 기준으로 기간별 매출, 매입, 이익을 봅니다(출고가 끝난 주문 기준).</p>
        </div>
      </div>

      <div className="sr-bar">
        <Segmented label="기간 단위" value={granularity} items={GRANULARITIES.map((g) => ({ key: g, label: GRANULARITY_LABEL[g] }))} onSelect={(g) => go({ g })} />
        <PeriodNav granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} grow onChange={(date) => go({ date })} />
      </div>
      <Segmented label="보기" value={view} items={(Object.keys(VIEW_LABEL) as SalesView[]).map((v) => ({ key: v, label: VIEW_LABEL[v] }))} onSelect={(v) => go({ view: v })} fill />

      {view === 'trend' && <TrendView series={props.series} totals={props.totals} margin={props.margin} unpricedLines={props.unpricedLines} periodLabel={period.label} />}
      {view === 'product' && <ProductView groups={props.byProduct} stats={props.productStats} periodLabel={period.label} filenameKey={filenameKey} />}
      {view === 'customer' && <CustomerView stats={props.customerStats} filenameKey={filenameKey} />}
      {view === 'terminal' && <TerminalView stats={props.terminalStats} filenameKey={filenameKey} />}
      {view === 'seller' && <GroupChart groups={props.bySeller} kind="seller" periodLabel={period.label} />}

      <style>{VIZ_CSS}</style>
      <style>{`
        .sr-root { display: flex; flex-direction: column; gap: var(--space-block); min-width: 0; }
        .sr-bar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.625rem 0.75rem; }
        .sr-note { font-size: var(--fs-sm); color: var(--text-muted); margin: 0; }
        .sr-muted { color: var(--text-muted); font-weight: 400; margin-left: 0.3rem; }
        .sr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
        .sr-list li { display: grid; grid-template-columns: minmax(0, 8rem) 1fr auto; align-items: center; gap: 0.6rem; font-size: var(--fs-sm); }
        .sr-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
        .sr-list-track { height: 8px; border-radius: 4px; background: var(--grid); overflow: hidden; }
        .sr-list-fill { display: block; height: 100%; border-radius: 4px; background: var(--series-1); }
        .sr-list-val { font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 700; white-space: nowrap; }
        @media (max-width: 860px) { .sr-bar { flex-wrap: nowrap; gap: 0.4rem; padding: 0.5rem; } }
      `}</style>
    </div>
  );
}
