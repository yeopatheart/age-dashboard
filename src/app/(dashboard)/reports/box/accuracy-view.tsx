'use client';
import { ChartLegend, LegendKey, TableView, type LegendEntry } from '@/components/viz/parts';
import { CATEGORICAL, OTHER_COLOR } from '@/components/viz/palette';
import { SegmentedBar } from '@/components/viz/segmented-bar';
import { TrendChart, type TrendDatum } from '@/components/viz/trend-chart';
import type { Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex } from '@/lib/reports/box-usage';
import { OUTCOME_LABEL, OUTCOME_ORDER, MIN_SAMPLE, rate, type AccStat, type AccuracySummary, type AxisRow, type Outcome, type SubmissionHistory } from '@/lib/reports/packing-accuracy';

const TOP_ROWS = 10; // 항목이 많은 축은 정확도가 낮은 위쪽 몇 개만 먼저 보여 준다

const pctText = (n: number, total: number) => (total === 0 ? '-' : `${Math.round((n / total) * 100)}%`);

// 지표 3개의 색은 슬롯 순서로 고정한다(1순위 일치=1번, 후보 3 안=2번, 그대로 수락=3번).
const METRICS: (LegendEntry & { pick: (s: AccStat) => number })[] = [
  { key: 'top1', name: '1순위 일치', color: CATEGORICAL[0], pick: (s) => s.top1 },
  { key: 'top3', name: '후보 3 안', color: CATEGORICAL[1], pick: (s) => s.top3 },
  { key: 'asIs', name: '그대로 수락', color: CATEGORICAL[2], pick: (s) => s.asIs },
];
const OUTCOME_COLOR = (o: Outcome, i: number) => (o === 'unknown' ? OTHER_COLOR : CATEGORICAL[i]);

const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;

function AxisTable({ rows }: { rows: AxisRow[] }) {
  return (
    <div className="viz-table-scroll">
      <table className="viz-table">
        <thead>
          <tr><th>항목</th><th>건수</th><th>1순위 일치</th><th>후보 3 안</th><th>그대로 수락</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.stat.total}</td>
              <td>
                <span className="rb-bar-cell">
                  <span className="rb-mini-track" aria-hidden><span className="rb-mini-fill" style={{ width: `${(r.stat.top1 / r.stat.total) * 100}%` }} /></span>
                  {pctText(r.stat.top1, r.stat.total)}
                </span>
              </td>
              <td>{pctText(r.stat.top3, r.stat.total)}</td>
              <td>{pctText(r.stat.asIs, r.stat.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccuracyView({
  accuracy,
  granularity,
  recordCount,
  withoutRecommendation,
  history,
  historyMissing,
}: {
  accuracy: AccuracySummary;
  granularity: Granularity;
  recordCount: number;
  withoutRecommendation: number;
  history: SubmissionHistory | null;
  historyMissing: string[] | null;
}) {
  const { stat } = accuracy;
  if (stat.total === 0) {
    return (
      <div className="viz-empty">
        이 기간에 추천이 있던 박스 제출 기록이 없습니다.
        {recordCount > 0 && <> (제출 {recordCount}건은 모두 추천 없이 제출되어 정확도에서 제외됩니다)</>}
      </div>
    );
  }

  const trendData: TrendDatum[] = accuracy.trend.map((p) => ({
    label: p.bucket.label,
    tipHead: granularity === 'year' ? `${p.bucket.key.slice(0, 4)}년 ${p.bucket.label}` : dateLabel(p.bucket.key),
    count: p.stat.total,
    top1: p.top1,
    top3: p.top3,
    asIs: p.asIs,
  }));
  const outcomeParts = OUTCOME_ORDER.map((o, i) => ({ key: o, name: OUTCOME_LABEL[o], value: accuracy.outcomes[o], color: OUTCOME_COLOR(o, i) }));

  return (
    <>
      <p className="rb-note">
        기간 안 제출 {recordCount}건 중 추천이 있던 {stat.total}건을 비교합니다{withoutRecommendation > 0 && <> (추천 없이 제출한 {withoutRecommendation}건은 제외)</>}. 같은 업체를 다시 제출했으면 마지막 제출 기준입니다.
      </p>

      <div className="rb-tiles">
        {METRICS.map((m) => (
          <div key={m.key} className="viz-tile">
            <span className="viz-tile-label"><LegendKey color={m.color} kind="box" />{m.name}</span>
            <span className="viz-tile-value">{pctText(m.pick(stat), stat.total)}</span>
            <span className="viz-sub">{m.pick(stat)} / {stat.total}건</span>
          </div>
        ))}
      </div>
      <p className="rb-note">1순위 일치 = 제출한 박스 종류 구성이 1순위 후보와 같음(상품 배치는 보지 않음) · 후보 3 안 = 후보 3개 중 하나와 같음 · 그대로 수락 = 1순위의 박스별 상품 배치까지 같음</p>

      {accuracy.trend.length > 1 && (
        <section className="viz-card">
          <div className="viz-head">
            <h2 className="viz-title">정확도 추이</h2>
            <span className="viz-sub">
              {granularity === 'year' ? '월별' : '일별'} · 건수가 없는 구간은 선이 끊깁니다
              {accuracy.trend.every((p) => p.top1 === p.asIs) && ' · 1순위 일치와 그대로 수락이 같아 두 선이 겹쳐 보입니다'}
            </span>
          </div>
          <ChartLegend entries={METRICS} kind="line" />
          <TrendChart data={trendData} series={METRICS} />
          <TableView
            head={['구간', '건수', ...METRICS.map((m) => m.name)]}
            rows={accuracy.trend.map((p) => [
              trendData[accuracy.trend.indexOf(p)].tipHead,
              p.stat.total,
              ...METRICS.map((m) => (p.stat.total === 0 ? '-' : pctText(m.pick(p.stat), p.stat.total))),
            ])}
          />
        </section>
      )}

      <section className="viz-card">
        <div className="viz-head">
          <h2 className="viz-title">추천과 실제는 어떻게 달랐나</h2>
          <span className="viz-sub">{stat.total}건</span>
        </div>
        <SegmentedBar parts={outcomeParts} total={stat.total} ariaLabel="추천과 실제의 차이" />
        <ul className="rb-out-list">
          {outcomeParts.map((p) => (
            <li key={p.key}>
              <LegendKey color={p.color} kind="box" />
              <span className="rb-out-name">{p.name}</span>
              <span className="rb-out-val">{p.value}건</span>
              <span className="viz-sub">{pctText(p.value, stat.total)}</span>
            </li>
          ))}
        </ul>
      </section>

      <h2 className="viz-title" style={{ margin: '0.25rem 0 0' }}>어떤 경우에 정확도가 떨어지나</h2>
      <p className="rb-note">항목별 정확도입니다. 순서가 없는 항목은 1순위 일치가 낮은 것부터 보이고, {MIN_SAMPLE}건 미만은 표본이 부족해 아래에 따로 모았습니다.</p>
      {accuracy.axes.map((axis) => (
        <section key={axis.id} className="viz-card">
          <div className="rb-axis-head">
            <h3 className="viz-title">{axis.title}</h3>
            {axis.hint && <span className="viz-sub">{axis.hint}</span>}
          </div>
          {axis.result.rows.length === 0 ? (
            <p className="rb-note">표본이 충분한 항목이 없습니다.</p>
          ) : axis.fixed || axis.result.rows.length <= TOP_ROWS + 2 ? (
            <AxisTable rows={axis.result.rows} />
          ) : (
            <>
              <AxisTable rows={axis.result.rows.slice(0, TOP_ROWS)} />
              <details className="viz-table-wrap">
                <summary>나머지 {axis.result.rows.length - TOP_ROWS}개 보기 (정확도가 높은 쪽)</summary>
                <AxisTable rows={axis.result.rows.slice(TOP_ROWS)} />
              </details>
            </>
          )}
          {axis.result.small.length > 0 && (
            <details className="viz-table-wrap">
              <summary>표본 부족 {axis.result.small.length}개 보기 ({MIN_SAMPLE}건 미만)</summary>
              <AxisTable rows={axis.result.small} />
            </details>
          )}
        </section>
      ))}

      <section className="viz-card">
        <h2 className="viz-title">최초 제출 vs 최종 제출</h2>
        {historyMissing ? (
          <p className="rb-note">제출 이력을 읽으려면 마이그레이션 {historyMissing.join(', ')}을 적용해야 합니다.</p>
        ) : !history || history.cards === 0 ? (
          <p className="rb-note">아직 이 기간에 쌓인 제출 이력이 없습니다. 제출 이력은 기록을 시작한 뒤(마이그레이션 0055 적용 이후) 제출한 건부터 쌓입니다.</p>
        ) : (
          <>
            <div className="viz-table-scroll">
              <table className="viz-table">
                <thead>
                  <tr><th>기준</th><th>건수</th><th>1순위 일치</th><th>후보 3 안</th><th>그대로 수락</th></tr>
                </thead>
                <tbody>
                  {([['처음 제출한 구성', history.first], ['최종 제출한 구성', history.final]] as const).map(([name, s]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{s.total}</td>
                      <td>{pctText(s.top1, s.total)}</td>
                      <td>{pctText(s.top3, s.total)}</td>
                      <td>{pctText(s.asIs, s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rb-note">
              제출 이력이 있는 업체 카드 {history.cards}곳 중 {history.resubmittedCards}곳({pctText(history.resubmittedCards, history.cards)})이 다시 제출됐습니다.
              {rate(history.first.top1, history.first.total) !== null && ' 처음과 최종의 차이가 크면 추천을 보고 고쳐 쓴 경우가 많다는 뜻입니다.'}
            </p>
          </>
        )}
      </section>
    </>
  );
}
