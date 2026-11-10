'use client';
import { CATEGORICAL } from '@/components/viz/palette';
import { ChartLegend, LegendKey, TableView } from '@/components/viz/parts';
import { StackedBars, type StackDatum } from '@/components/viz/stacked-bars';
import { TrendChart, type TrendDatum } from '@/components/viz/trend-chart';
import type { Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex } from '@/lib/reports/box-usage';
import { MIN_LINES, type ReviewGroup, type ReviewGroups } from '@/lib/reports/input-quality';
import type { InputData } from './ops-report-client';

const TOP_ROWS = 10;
const SERIES = [
  { key: 'review', name: '확인 필요율', color: CATEGORICAL[0] },
  { key: 'ai', name: 'AI 보정 비율', color: CATEGORICAL[1] },
];
const PASTE_SERIES = [
  { key: 'r1', name: '1차', color: CATEGORICAL[0] },
  { key: 'r2', name: '2차', color: CATEGORICAL[1] },
];
const pct = (n: number, d: number) => (d === 0 ? '-' : `${((n / d) * 100).toFixed(n / d < 0.1 ? 1 : 0)}%`);
const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;

function GroupTable({ rows, noun }: { rows: ReviewGroup[]; noun: string }) {
  return (
    <div className="viz-table-scroll">
      <table className="viz-table">
        <thead>
          <tr><th>{noun}</th><th>주문 줄</th><th>확인 필요</th><th>확인 필요율</th><th>AI 보정</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.lines}</td>
              <td>{r.review}</td>
              <td><span className="op-mini"><span className="op-mini-track" aria-hidden><span className="op-mini-fill" style={{ width: `${r.rate * 100}%` }} /></span>{pct(r.review, r.lines)}</span></td>
              <td>{r.ai > 0 ? r.ai : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupCard({ title, noun, groups, hint }: { title: string; noun: string; groups: ReviewGroups; hint?: string }) {
  const { rows, small } = groups;
  return (
    <section className="viz-card">
      <div className="viz-head">
        <h2 className="viz-title">{title}</h2>
        {hint && <span className="viz-sub">{hint}</span>}
      </div>
      {rows.length === 0 && small.length === 0 ? (
        <p className="op-note">이 기간에 확인 필요가 있었던 {noun}: 없음</p>
      ) : (
        <>
          {rows.length > 0 && <GroupTable rows={rows.slice(0, TOP_ROWS)} noun={noun} />}
          {rows.length > TOP_ROWS && (
            <details className="viz-table-wrap">
              <summary>나머지 {rows.length - TOP_ROWS}개 보기 (확인 필요율이 낮은 쪽)</summary>
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

// 주문 입력 보기: 카카오 붙여넣기 주문이 얼마나 깔끔하게 읽혔는지(확인 필요·AI 보정), 주문이 얼마나 바뀌는지, 입력 횟수.
export function InputView({ data, granularity }: { data: InputData; granularity: Granularity }) {
  const { summary } = data;
  if (summary.lines === 0 && summary.pastes === 0) return <div className="viz-empty">이 기간에 주문 입력 기록이 없습니다.</div>;

  const tip = (key: string, label: string) => (granularity === 'year' ? label : dateLabel(key));
  const trend: TrendDatum[] = data.trend.map((p) => ({ label: p.bucket.label, tipHead: tip(p.bucket.key, p.bucket.label), count: p.lines, review: p.reviewRate, ai: p.aiRate }));
  const pastes: StackDatum[] = data.trend.map((p) => ({ label: p.bucket.label, tipHead: tip(p.bucket.key, p.bucket.label), r1: p.pastes1, r2: p.pastes2 }));
  const { changes } = summary;
  const maxReason = Math.max(1, ...data.reasons.map((r) => r.count));
  const changeRows: [string, number][] = [['최초 주문', changes.none], ['이후 추가됨', changes.new], ['수정됨', changes.modified], ['취소됨', changes.cancelled]];

  return (
    <>
      <div className="op-tiles">
        <div className="viz-tile"><span className="viz-tile-label">확인 필요율</span><span className="viz-tile-value">{pct(summary.review, summary.lines)}</span><span className="viz-sub">{summary.review} / {summary.lines}줄 · 파서가 확신하지 못한 줄</span></div>
        <div className="viz-tile"><span className="viz-tile-label">AI 보정 비율</span><span className="viz-tile-value">{pct(summary.ai, summary.lines)}</span><span className="viz-sub">{summary.ai}줄 · 0055 적용 이후 입력분부터 기록</span></div>
        <div className="viz-tile"><span className="viz-tile-label">취소율</span><span className="viz-tile-value">{pct(changes.cancelled, summary.lines)}</span><span className="viz-sub">{changes.cancelled}줄 · 현재 상태 기준</span></div>
        <div className="viz-tile"><span className="viz-tile-label">카카오 붙여넣기</span><span className="viz-tile-value">{summary.pastes}회</span><span className="viz-sub">주문 입력을 확정한 횟수</span></div>
      </div>

      {data.trend.length > 1 && (
        <>
          <section className="viz-card">
            <div className="viz-head">
              <h2 className="viz-title">확인 필요율·AI 보정 비율 추이</h2>
              <span className="viz-sub">{granularity === 'year' ? '월별' : '일별'} · 주문 줄이 없는 구간은 선이 끊깁니다</span>
            </div>
            <ChartLegend entries={SERIES} kind="line" />
            <TrendChart data={trend} series={SERIES} countLabel="주문 줄 수" />
            <TableView
              head={['구간', '주문 줄', '확인 필요', '확인 필요율', 'AI 보정', 'AI 보정 비율']}
              rows={data.trend.map((p, i) => [trend[i].tipHead, p.lines, p.review, pct(p.review, p.lines), p.ai, pct(p.ai, p.lines)])}
            />
          </section>

          <section className="viz-card">
            <div className="viz-head">
              <h2 className="viz-title">카카오 붙여넣기 횟수</h2>
              <span className="viz-sub">하루에 몇 번 나눠 입력했는지(1차·2차)</span>
            </div>
            <ChartLegend entries={PASTE_SERIES} kind="box" />
            <StackedBars data={pastes} series={PASTE_SERIES} height={200} unit="회" />
            <TableView head={['구간', '1차', '2차']} rows={data.trend.map((p, i) => [trend[i].tipHead, p.pastes1, p.pastes2])} />
          </section>
        </>
      )}

      <div className="op-two">
        <section className="viz-card">
          <div className="viz-head">
            <h2 className="viz-title">주문은 얼마나 바뀌나</h2>
            <span className="viz-sub">현재 상태 기준(이력 없음)</span>
          </div>
          <div className="viz-table-scroll">
            <table className="viz-table">
              <thead><tr><th>구분</th><th>줄</th><th>비율</th></tr></thead>
              <tbody>
                {changeRows.map(([name, n]) => (
                  <tr key={name}><td>{name}</td><td>{n}</td><td>{pct(n, summary.lines)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="op-note">추가됨 = 그날 첫 입력 이후 새로 들어온 줄, 수정됨 = 이미 있는 줄의 수량·내용이 바뀐 것입니다.</p>
        </section>

        <section className="viz-card">
          <div className="viz-head">
            <h2 className="viz-title">확인 필요 사유</h2>
            <span className="viz-sub">파서가 쓰는 정해진 문구</span>
          </div>
          {data.reasons.length === 0 ? (
            <p className="op-note">이 기간에 확인 필요 줄이 없습니다.</p>
          ) : (
            <ul className="op-list">
              {data.reasons.slice(0, 12).map((r) => (
                <li key={r.reason}>
                  <LegendKey color={CATEGORICAL[0]} kind="box" />
                  <span style={{ overflowWrap: 'anywhere' }}>{r.reason}</span>
                  <span className="op-mini-track" aria-hidden><span className="op-mini-fill" style={{ width: `${(r.count / maxReason) * 100}%`, background: CATEGORICAL[0] }} /></span>
                  <strong>{r.count}줄</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <GroupCard title="품목별 확인 필요" noun="품목" groups={data.products} hint="파서가 어려워하는 표기를 찾는 용도" />
      <div className="op-two">
        <GroupCard title="업체별 확인 필요" noun="업체" groups={data.customers} hint="같은 날 1·2차는 한 업체로 합침" />
        <GroupCard title="터미널별 확인 필요" noun="터미널" groups={data.terminals} />
      </div>

      <p className="op-note">
        확인 필요는 붙여넣은 주문을 분석할 때 파서가 확신하지 못한 줄입니다(분석 때만 기록되고 이후 수정으로 지워지지 않습니다). 비율은 취소 줄을 포함한 전체 주문 줄 대비입니다.
        항목이 많으면 확인 필요율이 높은 위쪽 {TOP_ROWS}개만 먼저 보입니다.
      </p>
    </>
  );
}
