'use client';
import '@/components/admin/admin.css';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Timer } from 'lucide-react';
import { PeriodNav } from '@/components/date-nav';
import { Segmented } from '@/components/segmented';
import { ClockTrend, type ClockDatum } from '@/components/viz/clock-trend';
import { CATEGORICAL } from '@/components/viz/palette';
import { ChartLegend, LegendKey, TableView, type LegendEntry } from '@/components/viz/parts';
import { VIZ_CSS } from '@/components/viz/viz-css';
import { GRANULARITY_LABEL, type Granularity } from '@/lib/report';
import { WEEKDAY_LABEL, weekdayIndex } from '@/lib/reports/box-usage';
import {
  STAGE_LABEL,
  STAGE_ORDER,
  formatClock,
  formatDuration,
  minutesFromDayStart,
  windowMinutes,
  type DayOps,
  type IntervalKey,
  type IntervalStat,
  type SlowCard,
  type StageKey,
  type TerminalLoadStat,
} from '@/lib/reports/ops-time';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];
const STAGE_COLOR: Record<StageKey, string> = { box: CATEGORICAL[0], label: CATEGORICAL[1], pack: CATEGORICAL[2], load: CATEGORICAL[3] };
// 시리즈 키에 접두사를 붙인다: 단계 키 'label'(라벨 출력)이 차트 데이터의 가로축 이름 필드 label과 겹치지 않게 한다.
const seriesKey = (stage: StageKey) => `end_${stage}`;
const STAGE_SERIES: LegendEntry[] = STAGE_ORDER.map((s) => ({ key: seriesKey(s), name: `${STAGE_LABEL[s]} 마감`, color: STAGE_COLOR[s] }));

const dateLabel = (date: string) => `${date.slice(5).replace('-', '.')}(${WEEKDAY_LABEL[weekdayIndex(date)]})`;
const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export interface TimeReportProps {
  granularity: Granularity;
  anchor: string;
  today: string;
  period: { from: string; to: string; label: string };
  cardCount: number;
  parcelCount: number;
  submitFromHistory: number;
  outOfRangeCards: number; // 당일 범위 밖(소급 입력 등)의 시각이 있어 그 시각을 뺀 카드 수
  days: DayOps[];
  leadTimes: IntervalStat[];
  bottleneckKey: IntervalKey | null;
  slowest: SlowCard[];
  terminals: TerminalLoadStat[];
}

// 하루 작업 구간: 단계마다 첫 이벤트부터 마지막 완료까지를 하루 시각 축 위의 가로 막대로 보여 준다.
function DayTimeline({ day }: { day: DayOps }) {
  const spans = STAGE_ORDER.map((stage) => {
    const s = day.stages[stage];
    const start = s.start === null ? null : minutesFromDayStart(s.start, day.date);
    const end = s.end === null ? start : minutesFromDayStart(s.end, day.date);
    return { stage, s, start, end };
  });
  const all = spans.flatMap((x) => [x.start, x.end]).filter((v): v is number => v !== null);
  if (all.length === 0) return <p className="rt-note">이 날은 기록된 시각이 없습니다.</p>;
  const lo = Math.floor(Math.min(...all) / 60) * 60;
  let hi = Math.ceil(Math.max(...all) / 60) * 60;
  if (hi - lo < 120) hi = lo + 120;
  const range = hi - lo;
  const hours: number[] = [];
  for (let t = lo; t <= hi; t += range > 10 * 60 ? 120 : 60) hours.push(t);

  return (
    <div className="rt-timeline">
      <div className="rt-axis" aria-hidden>
        {hours.map((t) => (
          <span key={t} style={{ left: `${((t - lo) / range) * 100}%` }}>{formatClock(t)}</span>
        ))}
      </div>
      {spans.map(({ stage, s, start, end }) => {
        const none = start === null;
        const left = none ? 0 : ((start - lo) / range) * 100;
        const width = none || end === null ? 0 : Math.max(((end - start) / range) * 100, 0.8);
        const incomplete = s.total - s.done;
        return (
          <div key={stage} className="rt-row">
            <span className="rt-row-name"><LegendKey color={STAGE_COLOR[stage]} kind="box" />{STAGE_LABEL[stage]}</span>
            <div className="rt-track">
              {hours.map((t) => <span key={t} className="rt-grid" style={{ left: `${((t - lo) / range) * 100}%` }} />)}
              {!none && <span className="rt-fill" style={{ left: `${left}%`, width: `${width}%`, background: STAGE_COLOR[stage] }} title={`${STAGE_LABEL[stage]} ${formatClock(start)} ~ ${end === null ? '' : formatClock(end)}`} />}
            </div>
            <span className="rt-row-text">
              {none ? '기록 없음' : `${formatClock(start)} ~ ${s.end === null ? '진행 중' : formatClock(end as number)}`}
              {!none && windowMinutes(s) !== null && windowMinutes(s) !== 0 && <> · {formatDuration(windowMinutes(s))}</>}
              <span className={incomplete > 0 ? 'rt-warn' : 'rt-muted'}> · 완료 {s.done}/{s.total}카드</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TimeReportClient(props: TimeReportProps) {
  const { granularity, anchor, today, period, days, leadTimes, bottleneckKey, slowest, terminals } = props;
  const router = useRouter();
  const go = (next: { g?: Granularity; date?: string }) => router.push(`/reports/time?g=${next.g ?? granularity}&date=${next.date ?? anchor}`);

  const lastDay = [...days].reverse().find((d) => STAGE_ORDER.some((s) => d.stages[s].start !== null))?.date ?? days[days.length - 1]?.date ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((d) => d.date === (picked ?? lastDay)) ?? null;

  // 단계별 하루 작업 구간 평균(분)
  const windowAvg = Object.fromEntries(
    STAGE_ORDER.map((stage) => {
      const w = days.map((d) => windowMinutes(d.stages[stage])).filter((v): v is number => v !== null);
      return [stage, { avg: mean(w), n: w.length }];
    }),
  ) as Record<StageKey, { avg: number | null; n: number }>;
  const bottleneck = leadTimes.find((s) => s.key === bottleneckKey) ?? null;

  const trend: ClockDatum[] = days.map((d) => {
    const row: ClockDatum = { label: d.date.slice(5).replace('-', '.'), tipHead: dateLabel(d.date), note: `카드 ${d.cards}곳 · 박스 ${d.boxes}개` };
    for (const stage of STAGE_ORDER) row[seriesKey(stage)] = d.stages[stage].end === null ? null : minutesFromDayStart(d.stages[stage].end as number, d.date);
    return row;
  });
  const hasTrend = days.length > 1;

  return (
    <div className="rt-root viz-root">
      <div className="page-header">
        <div className="page-header-icon"><Timer size={20} /></div>
        <div>
          <h1 className="page-title">운영 시간 리포트</h1>
          <p className="page-sub">박스 할당 · 라벨 출력 · 포장 · 상차가 하루 중 언제, 얼마나 걸려 끝나는지 봅니다.</p>
        </div>
      </div>

      <div className="rt-bar">
        <Segmented label="기간 단위" value={granularity} items={GRANULARITIES.map((g) => ({ key: g, label: GRANULARITY_LABEL[g] }))} onSelect={(g) => go({ g })} />
        <PeriodNav granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} grow onChange={(date) => go({ date })} />
      </div>

      {props.cardCount === 0 ? (
        <div className="viz-empty">이 기간에 주문 카드가 없습니다.</div>
      ) : (
        <>
          <div className="rt-tiles">
            {STAGE_ORDER.map((stage) => (
              <div key={stage} className="viz-tile">
                <span className="viz-tile-label"><LegendKey color={STAGE_COLOR[stage]} kind="box" />{STAGE_LABEL[stage]} 하루 작업 구간</span>
                <span className="viz-tile-value">{formatDuration(windowAvg[stage].avg)}</span>
                <span className="viz-sub">평균 · {windowAvg[stage].n}일 기준</span>
              </div>
            ))}
            <div className="viz-tile">
              <span className="viz-tile-label">가장 오래 걸리는 구간</span>
              <span className="viz-tile-value" style={{ fontSize: 'var(--fs-lg)' }}>{bottleneck ? bottleneck.label : '-'}</span>
              <span className="viz-sub">{bottleneck && bottleneck.median !== null ? `중앙값 ${formatDuration(bottleneck.median)} · ${bottleneck.n}곳` : '완료된 카드가 아직 없습니다'}</span>
            </div>
          </div>

          {hasTrend && (
            <section className="viz-card">
              <div className="viz-head">
                <h2 className="viz-title">단계별 마감 시각 추이</h2>
                <span className="viz-sub">그날 각 단계를 마친 가장 늦은 시각</span>
              </div>
              <ChartLegend entries={STAGE_SERIES} kind="line" />
              <ClockTrend data={trend} series={STAGE_SERIES} />
              <TableView
                head={['날짜', '카드', '박스', ...STAGE_SERIES.map((s) => s.name)]}
                rows={days.map((d, i) => [dateLabel(d.date), d.cards, d.boxes, ...STAGE_ORDER.map((s) => (typeof trend[i][seriesKey(s)] === 'number' ? formatClock(trend[i][seriesKey(s)] as number) : '-'))])}
              />
            </section>
          )}

          <section className="viz-card">
            <div className="viz-head">
              <h2 className="viz-title">하루 작업 구간</h2>
              {days.length > 0 && (
                <label className="rt-pick">
                  날짜
                  <select value={selected?.date ?? ''} onChange={(e) => setPicked(e.target.value)}>
                    {days.map((d) => <option key={d.date} value={d.date}>{dateLabel(d.date)} · 카드 {d.cards}곳</option>)}
                  </select>
                </label>
              )}
            </div>
            {selected && <DayTimeline day={selected} />}
            <p className="rt-note">구간은 그 단계의 첫 이벤트부터 마지막 완료까지입니다. 중간에 쉬는 시간도 포함하므로, 한꺼번에 몰아서 하는 단계는 길게 나옵니다.</p>
          </section>

          <section className="viz-card">
            <div className="viz-head">
              <h2 className="viz-title">카드 단위 리드타임</h2>
              <span className="viz-sub">한 업체 카드가 단계에서 단계로 넘어가는 데 걸린 시간</span>
            </div>
            <div className="viz-table-scroll">
              <table className="viz-table">
                <thead>
                  <tr><th>구간</th><th>건수</th><th>중앙값</th><th>평균</th><th>90%</th><th>최대</th></tr>
                </thead>
                <tbody>
                  {leadTimes.map((s) => (
                    <tr key={s.key}>
                      <td>
                        {s.label}
                        {s.key === bottleneckKey && <span className="rt-tag">병목</span>}
                        {s.skippedOrder > 0 && <span className="rt-muted"> · 순서가 바뀐 {s.skippedOrder}곳 제외</span>}
                      </td>
                      <td>{s.n}</td>
                      <td>{formatDuration(s.median)}</td>
                      <td>{formatDuration(s.mean)}</td>
                      <td>{formatDuration(s.p90)}</td>
                      <td>{formatDuration(s.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rt-note">끝나지 않은 단계가 있는 카드는 뺍니다. 포장은 라벨 출력과 병행될 수 있어 포장이 먼저 끝난 카드(음수)는 해당 구간 통계에서 뺍니다. 택배 카드({props.parcelCount}곳)는 라벨·상차가 없어 제외합니다.</p>

            {slowest.length > 0 && (
              <>
                <h3 className="viz-title" style={{ marginTop: '0.5rem' }}>가장 오래 걸린 카드 (제출 → 상차 완료)</h3>
                <div className="viz-table-scroll">
                  <table className="viz-table">
                    <thead><tr><th>날짜</th><th>업체</th><th>터미널</th><th>걸린 시간</th></tr></thead>
                    <tbody>
                      {slowest.map((c) => (
                        <tr key={c.id}><td>{dateLabel(c.orderDate)}</td><td>{c.name}</td><td>{c.terminal}</td><td>{formatDuration(c.minutes)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="viz-card">
            <div className="viz-head">
              <h2 className="viz-title">터미널별 상차 완료 시각</h2>
              <span className="viz-sub">그 터미널의 박스가 모두 실린 시각 · 퀵기사 마감과 비교하세요</span>
            </div>
            {terminals.length === 0 ? (
              <p className="rt-note">상차를 마친 터미널이 아직 없습니다.</p>
            ) : (
              <div className="viz-table-scroll">
                <table className="viz-table">
                  <thead><tr><th>터미널</th><th>일수</th><th>중앙 완료 시각</th><th>가장 늦은 날</th><th>박스(중앙값/일)</th><th>미완료일</th></tr></thead>
                  <tbody>
                    {terminals.map((t) => (
                      <tr key={t.terminal}>
                        <td>{t.terminal}</td>
                        <td>{t.days}</td>
                        <td>{formatClock(t.median)}</td>
                        <td>{formatClock(t.latest)} ({dateLabel(t.latestDate)})</td>
                        <td>{t.medianBoxes}</td>
                        <td>{t.incompleteDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="rt-note">
            시각은 한국 시간입니다. 박스 할당 시각은 제출 이력이 있는 카드 {props.submitFromHistory}곳은 <b>최초 제출</b>, 나머지는 <b>마지막 제출</b> 시각입니다(이력은 0055 적용 이후 제출분부터 쌓입니다).
            포장 시각은 상품 줄의 포장 체크 시각이라, 체크를 해제하면 그 시각이 사라집니다.
            {props.outOfRangeCards > 0 && <> 출고일 전날 정오부터 다음날 정오까지를 당일 작업으로 보고, 그 밖에 입력된 시각(소급 입력·정정 등)이 있는 카드 {props.outOfRangeCards}곳은 해당 시각을 뺐습니다.</>}
          </p>
        </>
      )}

      <style>{VIZ_CSS}</style>
      <style>{`
        .rt-root { display: flex; flex-direction: column; gap: var(--space-block); min-width: 0; }
        .rt-bar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.625rem 0.75rem; }
        .rt-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; }
        .rt-note { font-size: var(--fs-sm); color: var(--text-muted); margin: 0; }
        .rt-muted { color: var(--text-muted); }
        .rt-warn { color: #b45309; font-weight: 700; }
        .rt-tag { margin-left: 0.4rem; font-size: var(--fs-xs); font-weight: 800; border-radius: 999px; padding: 0.1rem 0.5rem; background: #fef3c7; color: #b45309; }
        .rt-pick { display: inline-flex; align-items: center; gap: 0.4rem; font-size: var(--fs-sm); color: var(--text-secondary); }
        .rt-pick select { height: 2rem; border-radius: 999px; border: 1px solid var(--border); padding: 0 0.7rem; background: #fff; color: var(--text-primary); font-size: var(--fs-sm); }
        .rt-timeline { display: flex; flex-direction: column; gap: 0.5rem; }
        .rt-axis { position: relative; height: 1.1rem; margin-left: 7rem; margin-right: 0; font-size: var(--fs-xs); color: var(--text-muted); }
        .rt-axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
        .rt-row { display: grid; grid-template-columns: 7rem 1fr; grid-template-areas: 'name track' '. text'; column-gap: 0; row-gap: 0.15rem; align-items: center; }
        .rt-row-name { grid-area: name; display: inline-flex; align-items: center; gap: 0.45rem; font-size: var(--fs-sm); color: var(--text-secondary); }
        .rt-track { grid-area: track; position: relative; height: 18px; background: var(--grid); border-radius: 4px; overflow: hidden; }
        .rt-grid { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--surface-1); opacity: 0.8; }
        .rt-fill { position: absolute; top: 3px; bottom: 3px; min-width: 6px; border-radius: 4px; }
        .rt-row-text { grid-area: text; font-size: var(--fs-sm); color: var(--text-primary); font-variant-numeric: tabular-nums; }
        @media (max-width: 860px) { .rt-bar { flex-wrap: nowrap; gap: 0.4rem; padding: 0.5rem; } .rt-row { grid-template-columns: 5.5rem 1fr; } .rt-axis { margin-left: 5.5rem; } }
      `}</style>
    </div>
  );
}
