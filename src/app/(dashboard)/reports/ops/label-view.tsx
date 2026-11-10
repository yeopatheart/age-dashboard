'use client';
import { CATEGORICAL } from '@/components/viz/palette';
import { ChartLegend, TableView } from '@/components/viz/parts';
import { TrendChart, type TrendDatum } from '@/components/viz/trend-chart';
import type { Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex } from '@/lib/reports/box-usage';
import { MIN_LABELS, type LabelGroup } from '@/lib/reports/label-quality';
import type { LabelData } from './ops-report-client';

const TOP_ROWS = 10;
const SERIES = [
  { key: 'reprint', name: '재출력률', color: CATEGORICAL[0] },
  { key: 'undo', name: '스캔 되돌리기율', color: CATEGORICAL[1] },
];
const pct = (n: number, d: number) => (d === 0 ? '-' : `${((n / d) * 100).toFixed(n / d < 0.1 ? 1 : 0)}%`);
const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;

function GroupTable({ rows }: { rows: LabelGroup[] }) {
  return (
    <div className="viz-table-scroll">
      <table className="viz-table">
        <thead>
          <tr><th>업체</th><th>라벨</th><th>재출력</th><th>재출력률</th><th>스캔</th><th>되돌리기</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.labels}</td>
              <td>{r.reprinted > 0 ? r.reprinted : '-'}</td>
              <td>{pct(r.reprinted, r.labels)}</td>
              <td>{r.scans}</td>
              <td>{r.undos > 0 ? r.undos : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 라벨·상차 보기: 라벨 재출력률, 스캔 되돌리기율, 어떤 업체에서 잦은지. 재출력 사유(박스 종류 변경 등)는 저장되지 않아 횟수만 센다.
export function LabelView({ data, granularity }: { data: LabelData; granularity: Granularity }) {
  const { summary, groups } = data;
  if (summary.labels === 0 && summary.scans === 0) {
    return <div className="viz-empty">이 기간에 라벨 출력·상차 스캔 기록이 없습니다. 현장에서 라벨 출력과 상차 스캔을 쓰기 시작하면 쌓입니다.</div>;
  }
  const trend: TrendDatum[] = data.trend.map((p) => ({
    label: p.bucket.label,
    tipHead: granularity === 'year' ? p.bucket.label : dateLabel(p.bucket.key),
    count: p.labels,
    reprint: p.reprintRate,
    undo: p.undoRate,
  }));
  return (
    <>
      <div className="op-tiles">
        <div className="viz-tile"><span className="viz-tile-label">출력한 라벨</span><span className="viz-tile-value">{summary.labels}장</span><span className="viz-sub">업체 카드 {summary.cards}곳</span></div>
        <div className="viz-tile"><span className="viz-tile-label">재출력률</span><span className="viz-tile-value">{pct(summary.reprinted, summary.labels)}</span><span className="viz-sub">{summary.reprinted} / {summary.labels}장이 2번 이상 출력</span></div>
        <div className="viz-tile"><span className="viz-tile-label">추가 출력</span><span className="viz-tile-value">{summary.extraPrints}건</span><span className="viz-sub">재출력으로 더 뽑은 횟수</span></div>
        <div className="viz-tile"><span className="viz-tile-label">스캔 되돌리기율</span><span className="viz-tile-value">{pct(summary.undos, summary.scans)}</span><span className="viz-sub">{summary.undos} / {summary.scans}건</span></div>
        <div className="viz-tile"><span className="viz-tile-label">재출력이 있었던 카드</span><span className="viz-tile-value">{pct(summary.cardsReprinted, summary.cards)}</span><span className="viz-sub">{summary.cardsReprinted} / {summary.cards}곳</span></div>
      </div>

      {data.trend.length > 1 && (
        <section className="viz-card">
          <div className="viz-head">
            <h2 className="viz-title">재출력률·되돌리기율 추이</h2>
            <span className="viz-sub">{granularity === 'year' ? '월별' : '일별'} · 라벨이 없는 구간은 선이 끊깁니다</span>
          </div>
          <ChartLegend entries={SERIES} kind="line" />
          <TrendChart data={trend} series={SERIES} countLabel="출력한 라벨 수" />
          <TableView
            head={['구간', '출력한 라벨', '재출력', '재출력률', '스캔', '되돌리기', '되돌리기율']}
            rows={data.trend.map((p, i) => [trend[i].tipHead, p.labels, p.reprinted, pct(p.reprinted, p.labels), p.scans, p.undos, pct(p.undos, p.scans)])}
          />
        </section>
      )}

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">업체별 재출력·되돌리기</h2>
          <span className="viz-sub">재출력이나 되돌리기가 있었던 업체만 · 같은 날 1·2차는 한 업체로 합침</span>
        </div>
        {groups.rows.length === 0 && groups.small.length === 0 ? (
          <p className="op-note">이 기간에 재출력이나 되돌리기가 있었던 업체: 없음</p>
        ) : (
          <>
            {groups.rows.length > 0 && <GroupTable rows={groups.rows.slice(0, TOP_ROWS)} />}
            {groups.rows.length > TOP_ROWS && (
              <details className="viz-table-wrap">
                <summary>나머지 {groups.rows.length - TOP_ROWS}곳 보기</summary>
                <GroupTable rows={groups.rows.slice(TOP_ROWS)} />
              </details>
            )}
            {groups.small.length > 0 && (
              <details className="viz-table-wrap">
                <summary>표본 부족 {groups.small.length}곳 보기 (라벨 {MIN_LABELS}장 미만)</summary>
                <GroupTable rows={groups.small} />
              </details>
            )}
          </>
        )}
      </section>

      <p className="op-note">
        재출력 = 한 라벨의 출력 기록이 2번 이상인 것, 스캔 되돌리기율 = 되돌리기 ÷ 스캔입니다(합포장으로 묶인 박스는 각각 셉니다). 재출력의 사유(박스 종류 변경 등)는 저장되지 않아 횟수만 셉니다.
        항목이 많으면 재출력률이 높은 위쪽 {TOP_ROWS}곳만 먼저 보입니다.
      </p>
    </>
  );
}
