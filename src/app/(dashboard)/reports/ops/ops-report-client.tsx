'use client';
import '@/components/admin/admin.css';
import { useRouter } from 'next/navigation';
import { ClipboardCheck } from 'lucide-react';
import { PeriodNav } from '@/components/date-nav';
import { Segmented } from '@/components/segmented';
import { VIZ_CSS } from '@/components/viz/viz-css';
import { GRANULARITY_LABEL, type Granularity } from '@/lib/report';
import type { CompletionPoint, InputLag, OpenPurchase, OpenSalesDay, Receivables } from '@/lib/reports/settle-close';
import type { InputSummary, InputTrendPoint, ReviewGroups } from '@/lib/reports/input-quality';
import type { LabelGroups, LabelSummary, LabelTrendPoint } from '@/lib/reports/label-quality';
import type { UnshippedGroups, UnshippedSummary, UnshippedTrendPoint } from '@/lib/reports/unshipped';
import { InputView } from './input-view';
import { LabelView } from './label-view';
import { SettleView } from './settle-view';
import { UnshippedView } from './unshipped-view';

export type OpsView = 'unshipped' | 'input' | 'label' | 'settle';
const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

export interface UnshippedData {
  summary: UnshippedSummary;
  trend: UnshippedTrendPoint[];
  products: UnshippedGroups;
  customers: UnshippedGroups;
  terminals: UnshippedGroups;
  reasons: { reason: string; count: number }[];
}

export interface InputData {
  summary: InputSummary;
  trend: InputTrendPoint[];
  reasons: { reason: string; count: number }[];
  products: ReviewGroups;
  customers: ReviewGroups;
  terminals: ReviewGroups;
}

export interface LabelData {
  summary: LabelSummary;
  trend: LabelTrendPoint[];
  groups: LabelGroups;
}

export interface SettleData {
  trend: CompletionPoint[];
  openSales: OpenSalesDay[];
  openPurchases: OpenPurchase[];
  openPurchaseTotal: number;
  receivables: Receivables;
  payables: { total: number; rows: number };
  salesLag: InputLag;
  purchaseLag: InputLag;
  salesLines: number;
}

export interface OpsReportProps {
  view: OpsView;
  canSettle: boolean;
  granularity: Granularity;
  anchor: string;
  today: string;
  period: { from: string; to: string; label: string };
  unshipped: UnshippedData | null;
  input: InputData | null;
  label: LabelData | null;
  settle: SettleData | null;
}

export function OpsReportClient(props: OpsReportProps) {
  const { view, canSettle, granularity, anchor, today, period } = props;
  const router = useRouter();
  const go = (next: { g?: Granularity; date?: string; view?: OpsView }) =>
    router.push(`/reports/ops?g=${next.g ?? granularity}&date=${next.date ?? anchor}&view=${next.view ?? view}`);
  const views: { key: OpsView; label: string }[] = [{ key: 'unshipped', label: '미출고' }, { key: 'input', label: '주문 입력' }, { key: 'label', label: '라벨·상차' }, ...(canSettle ? [{ key: 'settle' as const, label: '정산 마감' }] : [])];

  return (
    <div className="op-root viz-root">
      <div className="page-header">
        <div className="page-header-icon"><ClipboardCheck size={20} /></div>
        <div>
          <h1 className="page-title">운영 개선 리포트</h1>
          <p className="page-sub">미출고, 주문 입력, 라벨·상차, 정산 마감처럼 반복되는 문제를 찾아 운영 방식을 고치는 데 씁니다.</p>
        </div>
      </div>

      <div className="op-bar">
        <Segmented label="기간 단위" value={granularity} items={GRANULARITIES.map((g) => ({ key: g, label: GRANULARITY_LABEL[g] }))} onSelect={(g) => go({ g })} />
        <PeriodNav granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} grow onChange={(date) => go({ date })} />
      </div>
      {views.length > 1 && <Segmented label="보기" value={view} items={views} onSelect={(v) => go({ view: v })} fill />}

      {view === 'unshipped' && props.unshipped && <UnshippedView data={props.unshipped} granularity={granularity} />}
      {view === 'input' && props.input && <InputView data={props.input} granularity={granularity} />}
      {view === 'label' && props.label && <LabelView data={props.label} granularity={granularity} />}
      {view === 'settle' && props.settle && <SettleView data={props.settle} granularity={granularity} periodKey={`${period.from}_${period.to}`} />}

      <style>{VIZ_CSS}</style>
      <style>{`
        .op-root { display: flex; flex-direction: column; gap: var(--space-block); min-width: 0; }
        .op-bar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.625rem 0.75rem; }
        .op-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); gap: 0.75rem; }
        .op-note { font-size: var(--fs-sm); color: var(--text-muted); margin: 0; }
        .op-muted { color: var(--text-muted); }
        .op-mini { display: inline-flex; align-items: center; gap: 0.5rem; justify-content: flex-end; }
        .op-mini-track { width: 4.5rem; height: 6px; border-radius: 3px; background: var(--grid); overflow: hidden; flex: none; }
        .op-mini-fill { display: block; height: 100%; background: var(--series-2); border-radius: 3px; }
        .op-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; font-size: var(--fs-sm); }
        .op-list li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.5rem; align-items: center; }
        .op-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-block); }
        @media (max-width: 860px) { .op-two { grid-template-columns: 1fr; } .op-bar { flex-wrap: nowrap; gap: 0.4rem; padding: 0.5rem; } }
      `}</style>
    </div>
  );
}
