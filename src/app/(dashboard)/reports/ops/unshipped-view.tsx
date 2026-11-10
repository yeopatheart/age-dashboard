'use client';
import { CATEGORICAL } from '@/components/viz/palette';
import { LegendKey, TableView } from '@/components/viz/parts';
import { TrendChart, type TrendDatum } from '@/components/viz/trend-chart';
import type { Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex } from '@/lib/reports/box-usage';
import { MIN_LINES, type UnshippedGroup, type UnshippedGroups } from '@/lib/reports/unshipped';
import { quantityText } from '@/lib/reports/sales-report';
import type { UnshippedData } from './ops-report-client';

const TOP_ROWS = 10;
const RATE = { key: 'rate', name: '미출고율', color: CATEGORICAL[1] };
const pct = (r: number | null) => (r === null ? '-' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;

function GroupTable({ rows, noun }: { rows: UnshippedGroup[]; noun: string }) {
  return (
    <div className="viz-table-scroll">
      <table className="viz-table">
        <thead>
          <tr><th>{noun}</th><th>주문 줄</th><th>미출고 줄</th><th>미출고율</th><th>전량</th><th>미출고 수량</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.lines}</td>
              <td>{r.unshippedLines}</td>
              <td><span className="op-mini"><span className="op-mini-track" aria-hidden><span className="op-mini-fill" style={{ width: `${r.rate * 100}%` }} /></span>{pct(r.rate)}</span></td>
              <td>{r.fullLines > 0 ? r.fullLines : '-'}</td>
              <td style={{ textAlign: 'left' }}>{quantityText(r.quantities)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupCard({ title, noun, groups, hint }: { title: string; noun: string; groups: UnshippedGroups; hint?: string }) {
  const { rows, small } = groups;
  return (
    <section className="viz-card">
      <div className="viz-head">
        <h2 className="viz-title">{title}</h2>
        {hint && <span className="viz-sub">{hint}</span>}
      </div>
      {rows.length === 0 && small.length === 0 ? (
        <p className="op-note">이 기간에 미출고가 발생한 {noun}: 없음</p>
      ) : (
        <>
          {rows.length > 0 && <GroupTable rows={rows.slice(0, TOP_ROWS)} noun={noun} />}
          {rows.length > TOP_ROWS && (
            <details className="viz-table-wrap">
              <summary>나머지 {rows.length - TOP_ROWS}개 보기 (미출고율이 낮은 쪽)</summary>
              <GroupTable rows={rows.slice(TOP_ROWS)} noun={noun} />
            </details>
          )}
          {small.length > 0 && (
            <details className="viz-table-wrap">
              <summary>표본 부족 {small.length}개 보기 (주문 줄 {MIN_LINES}개 미만)</summary>
              <GroupTable rows={small} noun={noun} />
            </details>
          )}
        </>
      )}
    </section>
  );
}

// 미출고 보기: 미출고율 추이, 어떤 품목·업체·터미널에서 잦은지, 사유. 값은 "현재 상태"다(이력이 없어 처음 얼마였는지는 모른다).
export function UnshippedView({ data, granularity }: { data: UnshippedData; granularity: Granularity }) {
  const { summary } = data;
  if (summary.lines === 0) return <div className="viz-empty">이 기간에 주문 줄이 없습니다.</div>;

  const trend: TrendDatum[] = data.trend.map((p) => ({
    label: p.bucket.label,
    tipHead: granularity === 'year' ? p.bucket.label : dateLabel(p.bucket.key),
    count: p.lines,
    rate: p.rate,
  }));
  const maxReason = Math.max(1, ...data.reasons.map((r) => r.count));

  return (
    <>
      <div className="op-tiles">
        <div className="viz-tile"><span className="viz-tile-label">미출고율</span><span className="viz-tile-value">{pct(summary.rate)}</span><span className="viz-sub">{summary.unshippedLines} / {summary.lines}줄</span></div>
        <div className="viz-tile"><span className="viz-tile-label">미출고 줄</span><span className="viz-tile-value">{summary.unshippedLines}줄</span><span className="viz-sub">취소·수량 미정 제외</span></div>
        <div className="viz-tile"><span className="viz-tile-label">전량 미출고 줄</span><span className="viz-tile-value">{summary.fullLines}줄</span><span className="viz-sub">주문 수량 전부 출고 못 함</span></div>
        <div className="viz-tile"><span className="viz-tile-label">미출고 수량</span><span className="viz-tile-value" style={{ fontSize: 'var(--fs-lg)' }}>{quantityText(summary.quantities)}</span><span className="viz-sub">단위별 합</span></div>
      </div>

      {data.trend.length > 1 && (
        <section className="viz-card">
          <div className="viz-head">
            <h2 className="viz-title">미출고율 추이</h2>
            <span className="viz-sub">{granularity === 'year' ? '월별' : '일별'} · 주문 줄이 없는 구간은 선이 끊깁니다</span>
          </div>
          <TrendChart data={trend} series={[RATE]} countLabel="주문 줄 수" />
          <TableView head={['구간', '주문 줄', '미출고 줄', '미출고율']} rows={data.trend.map((p, i) => [trend[i].tipHead, p.lines, p.unshippedLines, pct(p.rate)])} />
        </section>
      )}

      <GroupCard title="품목별 미출고" noun="품목" groups={data.products} hint="미출고율이 높은 품목 = 공급을 점검할 품목" />

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">미출고 사유</h2>
          <span className="viz-sub">사유는 직접 적은 글이라 같은 글끼리 셉니다</span>
        </div>
        {data.reasons.length === 0 ? (
          <p className="op-note">이 기간에 미출고가 없습니다.</p>
        ) : (
          <ul className="op-list">
            {data.reasons.slice(0, 15).map((r) => (
              <li key={r.reason}>
                <LegendKey color={CATEGORICAL[1]} kind="box" />
                <span style={{ overflowWrap: 'anywhere' }}>{r.reason}</span>
                <span className="op-mini-track" aria-hidden><span className="op-mini-fill" style={{ width: `${(r.count / maxReason) * 100}%` }} /></span>
                <strong>{r.count}줄</strong>
              </li>
            ))}
          </ul>
        )}
        {data.reasons.length > 15 && <p className="op-note">상위 15개만 보입니다(전체 {data.reasons.length}가지).</p>}
      </section>

      <div className="op-two">
        <GroupCard title="업체별 미출고" noun="업체" groups={data.customers} hint="같은 날 1·2차는 한 업체로 합침" />
        <GroupCard title="터미널별 미출고" noun="터미널" groups={data.terminals} />
      </div>

      <p className="op-note">미출고는 주문은 유효하지만 현장에서 출고하지 못한 수량입니다(주문 취소와 별개). 미출고율은 취소·수량 미정을 뺀 주문 줄 대비 미출고 줄입니다. 항목이 많으면 미출고율이 높은 위쪽 {TOP_ROWS}개만 먼저 보입니다.</p>
    </>
  );
}
