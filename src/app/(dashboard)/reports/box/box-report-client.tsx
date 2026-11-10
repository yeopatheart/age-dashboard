'use client';
import '@/components/admin/admin.css';
import { useRouter } from 'next/navigation';
import { PackageOpen } from 'lucide-react';
import { PeriodNav } from '@/components/date-nav';
import { Segmented } from '@/components/segmented';
import { VIZ_CSS } from '@/components/viz/viz-css';
import { GRANULARITY_LABEL, type Granularity } from '@/lib/report';
import type { BoxUsage } from '@/lib/reports/box-usage';
import type { AccuracySummary, SubmissionHistory } from '@/lib/reports/packing-accuracy';
import { AccuracyView } from './accuracy-view';
import { UsageView } from './usage-view';

type View = 'usage' | 'accuracy';
const VIEW_LABEL: Record<View, string> = { usage: '사용량', accuracy: '추천 정확도' };

export interface BoxReportProps {
  view: View;
  granularity: Granularity;
  anchor: string;
  today: string;
  period: { from: string; to: string; label: string };
  boxOrder: string[]; // 박스 종류 이름(색이 박스마다 고정되게 하는 안정된 순서)
  recordCount: number; // 기간 안 박스 제출 기록 수
  withoutRecommendation: number; // 그중 추천이 없던 기록
  usage: BoxUsage | null;
  accuracy: AccuracySummary | null;
  history: SubmissionHistory | null;
  historyMissing: string[] | null; // 제출 이력 마이그레이션이 없을 때 필요한 파일
}

export function BoxReportClient(props: BoxReportProps) {
  const { view, granularity, anchor, today, period } = props;
  const router = useRouter();
  const go = (next: { g?: Granularity; date?: string; view?: View }) =>
    router.push(`/reports/box?g=${next.g ?? granularity}&date=${next.date ?? anchor}&view=${next.view ?? view}`);

  return (
    <div className="rb-root viz-root">
      <div className="page-header">
        <div className="page-header-icon"><PackageOpen size={20} /></div>
        <div>
          <h1 className="page-title">박스 리포트</h1>
          <p className="page-sub">제출한 박스 구성을 기준으로 박스 사용량과 추천 정확도를 봅니다.</p>
        </div>
      </div>

      <div className="rb-bar">
        <Segmented label="기간 단위" value={granularity} items={(Object.keys(GRANULARITY_LABEL) as Granularity[]).map((g) => ({ key: g, label: GRANULARITY_LABEL[g] }))} onSelect={(g) => go({ g })} />
        <PeriodNav granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} grow onChange={(date) => go({ date })} />
      </div>
      <Segmented label="보기" value={view} items={(Object.keys(VIEW_LABEL) as View[]).map((v) => ({ key: v, label: VIEW_LABEL[v] }))} onSelect={(v) => go({ view: v })} fill />

      {view === 'usage' && props.usage && <UsageView usage={props.usage} granularity={granularity} boxOrder={props.boxOrder} />}
      {view === 'accuracy' && props.accuracy && (
        <AccuracyView
          accuracy={props.accuracy}
          granularity={granularity}
          recordCount={props.recordCount}
          withoutRecommendation={props.withoutRecommendation}
          history={props.history}
          historyMissing={props.historyMissing}
        />
      )}

      <style>{VIZ_CSS}</style>
      <style>{`
        .rb-root { display: flex; flex-direction: column; gap: var(--space-block); min-width: 0; }
        .rb-bar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.625rem 0.75rem; }
        .rb-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); gap: 0.75rem; }
        .rb-note { font-size: var(--fs-sm); color: var(--text-muted); margin: 0; }
        .rb-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-block); }
        @media (max-width: 860px) { .rb-two { grid-template-columns: 1fr; } .rb-bar { flex-wrap: nowrap; gap: 0.4rem; padding: 0.5rem; } }
        .rb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
        .rb-list li { display: grid; grid-template-columns: minmax(0, 8rem) 1fr auto; align-items: center; gap: 0.6rem; font-size: var(--fs-sm); }
        .rb-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
        .rb-list-track { height: 8px; border-radius: 4px; background: var(--grid); overflow: hidden; }
        .rb-list-fill { display: block; height: 100%; border-radius: 4px; background: var(--series-1); }
        .rb-list-val { font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 700; }
        .rb-name { display: inline-flex; align-items: center; gap: 0.45rem; }
        .rb-heat { text-align: center !important; min-width: 2.6rem; }
        .rb-bar-cell { display: flex; align-items: center; gap: 0.5rem; justify-content: flex-end; }
        .rb-mini-track { width: 4.5rem; height: 6px; border-radius: 3px; background: var(--grid); overflow: hidden; flex: none; }
        .rb-mini-fill { display: block; height: 100%; background: var(--series-1); border-radius: 3px; }
        .rb-axis-head { display: flex; flex-direction: column; gap: 0.15rem; }
        .rb-out-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; font-size: var(--fs-sm); }
        .rb-out-list li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.5rem; align-items: center; }
        .rb-out-name { color: var(--text-secondary); }
        .rb-out-val { font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 700; }
      `}</style>
    </div>
  );
}
