'use client';
import { useState, useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type DotItemDotProps, type LabelProps, type TooltipContentProps } from 'recharts';
import { axisFormatter, niceScale, type DayPoint } from '@/lib/settlement/chart';
import type { GroupPoint } from '@/lib/settlement/chart-groups';
import type { PurchaseTotals } from '@/lib/settlement/purchases';
import { formatWon } from '@/lib/money';
import { GroupChart } from './group-chart';
import { Key, Legend, SERIES, won } from './chart-shared';

// 정산 그래프. 주·월 조회는 일별 추이를 선 그래프로, 일 조회는 하루의 판매가·매입가·수익을 나란히 비교하는 막대로 보여 준다.
// 색은 항목마다 고정이다(판매가=1번, 매입가=2번, 수익=3번 슬롯). 상태색(초록·빨강)은 쓰지 않는다 — 수익이 적자여도 "상태"가 아니라 숫자다.
// 규격(선 2px, 막대 24px 이하·4px 둥근 끝, 2px 표면 링, 실선 헤어라인 격자)과 십자선·툴팁·표로 보기는 dataviz 지침을 따른다.

type ChartView = 'all' | 'product' | 'seller';
const VIEWS: { key: ChartView; name: string }[] = [
  { key: 'all', name: '전체' },
  { key: 'product', name: '품목별' },
  { key: 'seller', name: '사업자별' },
];
// 기간을 옮기면 그래프가 새로 만들어지지만(page.tsx의 key), 보던 보기(전체·품목별·사업자별)는 그대로 유지한다.
// 페이지를 새로 불러오면 '전체'로 돌아간다. 브라우저 저장소에 두면 새로 불러올 때 서버 화면('전체')과 어긋나 화면이 동작하지 않는 문제가 있어(hydration) 메모리에만 둔다.
const viewMemory = new Map<string, ChartView>();
const viewListeners = new Set<() => void>();
const readView = (): ChartView => viewMemory.get('view') ?? 'all';
function writeView(v: ChartView): void {
  viewMemory.set('view', v);
  viewListeners.forEach((l) => l());
}
const subscribeView = (cb: () => void) => {
  viewListeners.add(cb);
  return () => {
    viewListeners.delete(cb);
  };
};

const LINE_H = 320;
const LINE_MARGIN = { top: 12, bottom: 4, left: 4 };
const X_AXIS_H = 28;
const BAR_H = 300;
const END_LABEL_GAP_PX = 16; // 선 끝 이름표 사이가 이보다 가까우면 이름표를 빼고 범례·툴팁에 맡긴다(쌓아 올리면 선에서 떨어져 읽기 어렵다)

// 라이트 전용: 앱 전체가 라이트라서 다크 토큰은 켜지 않는다(OS 다크일 때 밝은 페이지 위에 어두운 카드만 뜨는 것을 막는다).
// 다크 팔레트는 검증 완료(표면 #1a1a19): 1번 #3987e5, 2번 #d95926, 3번 #199e70 — 앱에 다크 테마가 생기면 아래 변수를 같은 방식으로 덮어쓴다.
const VIZ_CSS = `
.viz-root { --surface-1: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --hover: rgba(11, 11, 11, 0.05); --border: rgba(11, 11, 11, 0.10); --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
.viz-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
.viz-tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.viz-tile-label { display: inline-flex; align-items: center; gap: 0.45rem; font-size: var(--fs-sm); color: var(--text-secondary); }
.viz-tile-value { font-size: var(--fs-num); font-weight: 800; color: var(--text-primary); line-height: 1.2; overflow-wrap: anywhere; }
.viz-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: var(--space-inner); min-width: 0; }
.viz-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.viz-title { font-size: var(--fs-lg); font-weight: 800; color: var(--text-primary); }
.viz-sub { font-size: var(--fs-xs); color: var(--text-muted); }
.viz-legend { display: flex; gap: 1.1rem; flex-wrap: wrap; font-size: var(--fs-sm); color: var(--text-secondary); }
.viz-legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
.viz-key-line { display: inline-block; width: 16px; height: 2px; border-radius: 1px; }
.viz-key-box { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.viz-tip { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 0.55rem 0.7rem; box-shadow: 0 4px 14px rgba(11, 11, 11, 0.12); font-size: var(--fs-sm); min-width: 11rem; display: flex; flex-direction: column; gap: 0.3rem; }
.viz-tip-head { color: var(--text-secondary); font-size: var(--fs-xs); }
.viz-tip-row { display: flex; align-items: center; gap: 0.5rem; }
.viz-tip-row strong { color: var(--text-primary); font-weight: 600; margin-left: auto; padding-left: 0.6rem; }
.viz-tip-name { color: var(--text-secondary); }
.viz-tip-note { color: var(--text-muted); font-size: var(--fs-xs); border-top: 1px solid var(--grid); padding-top: 0.3rem; }
.viz-views { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.viz-view-btn, .viz-seg-btn { height: 2.25rem; padding: 0 1rem; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 700; cursor: pointer; }
.viz-view-btn.is-on, .viz-seg-btn.is-on { background: var(--text-primary); border-color: var(--text-primary); color: #fff; }
.viz-controls { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem 1rem; flex-wrap: wrap; }
.viz-seg { display: inline-flex; align-items: center; gap: 0.3rem; }
.viz-seg-label { font-size: var(--fs-xs); color: var(--text-muted); margin-right: 0.2rem; }
.viz-seg-btn { height: 1.9rem; padding: 0 0.8rem; font-weight: 600; }
.viz-empty { padding: 3rem 1rem; text-align: center; color: var(--text-muted); }
.viz-table-wrap summary { cursor: pointer; font-size: var(--fs-sm); color: var(--text-secondary); }
.viz-table-scroll { overflow-x: auto; margin-top: 0.5rem; }
.viz-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
.viz-table th, .viz-table td { padding: 0.35rem 0.6rem; text-align: right; border-bottom: 1px solid var(--grid); white-space: nowrap; }
.viz-table th:first-child, .viz-table td:first-child { text-align: left; }
.viz-table th { color: var(--text-secondary); font-weight: 600; }
.viz-table tfoot td { font-weight: 600; border-bottom: 0; }
@media (max-width: 720px) { .viz-tiles { grid-template-columns: 1fr; } }
`;

// 십자선이 가리킨 날짜의 모든 항목을 한 번에 보여 준다. 값이 앞에 오고 이름은 뒤에 둔다.
function LineTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as DayPoint;
  return (
    <div className="viz-tip">
      <div className="viz-tip-head">{p.label} ({p.weekday})</div>
      {SERIES.map((s) => (
        <div key={s.key} className="viz-tip-row">
          <Key color={s.color} kind="line" />
          <span className="viz-tip-name">{s.name}</span>
          <strong>{won(p[s.key])}</strong>
        </div>
      ))}
      {p.missingPrice > 0 && <div className="viz-tip-note">매입가 미입력 {p.missingPrice}건은 수익에서 뺐습니다</div>}
    </div>
  );
}

interface BarDatum {
  key: (typeof SERIES)[number]['key'];
  name: string;
  value: number;
  color: string;
}

function BarTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload as BarDatum;
  return (
    <div className="viz-tip">
      <div className="viz-tip-row">
        <Key color={d.color} kind="box" />
        <span className="viz-tip-name">{d.name}</span>
        <strong>{won(d.value)}</strong>
      </div>
    </div>
  );
}

export function ChartClient({
  series,
  totals,
  periodLabel,
  byProduct,
  bySeller,
}: {
  series: DayPoint[];
  totals: PurchaseTotals;
  periodLabel: string;
  byProduct: GroupPoint[];
  bySeller: GroupPoint[];
}) {
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  const view = useSyncExternalStore(subscribeView, readView, () => 'all' as ChartView);
  const setView = writeView;
  const isDay = series.length === 1;
  const empty = totals.salesTotal === 0 && totals.purchaseTotal === 0 && totals.rows === 0;
  const summary = `${periodLabel} 판매가 ${won(totals.salesTotal)}, 매입가 ${won(totals.purchaseTotal)}, 수익 ${won(totals.profitTotal)}`;

  // ─── 선 그래프(주·월) ───
  const lineValues = series.flatMap((p) => SERIES.map((s) => p[s.key]));
  const lineScale = niceScale(lineValues);
  const last = series[series.length - 1];
  const plotH = LINE_H - LINE_MARGIN.top - LINE_MARGIN.bottom - X_AXIS_H;
  const pxOf = (v: number) => ((lineScale.max - v) / (lineScale.max - lineScale.min)) * plotH;
  const endYs = SERIES.map((s) => pxOf(last[s.key])).sort((a, b) => a - b);
  const showEndLabels = endYs.every((y, i) => i === 0 || y - endYs[i - 1] >= END_LABEL_GAP_PX);
  const lastIndex = series.length - 1;
  const lineAxis = axisFormatter(lineScale.max);

  // ─── 막대(일) ───
  const bars: BarDatum[] = SERIES.map((s) => ({ key: s.key, name: s.name, value: series[0]?.[s.key] ?? 0, color: s.color }));
  const barScale = niceScale(bars.map((b) => b.value), 5, true); // 막대 끝 값 라벨이 들어갈 여유 포함
  const barAxis = axisFormatter(barScale.max);
  const BAR_THICK = 24;
  const RADIUS = 4;

  // 막대 모양: 기준선 쪽은 네모, 값이 있는 끝만 4px 둥글게. 값이 음수면 아래쪽 끝이 둥글다.
  const barShape = (props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: BarDatum }) => {
    const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props;
    const top = Math.min(y, y + height);
    const bottom = Math.max(y, y + height);
    const h = bottom - top;
    if (h < 0.5 || !payload) return <g key={`bar-${index}`} />;
    const r = Math.min(RADIUS, h, width / 2);
    const positive = payload.value >= 0;
    const d = positive
      ? `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
      : `M${x},${top} L${x},${bottom - r} Q${x},${bottom} ${x + r},${bottom} L${x + width - r},${bottom} Q${x + width},${bottom} ${x + width},${bottom - r} L${x + width},${top} Z`;
    return <path key={`bar-${index}`} d={d} fill={payload.color} fillOpacity={hoverBar === null || hoverBar === index ? 1 : 0.55} style={{ transition: 'fill-opacity 120ms' }} />;
  };

  // 막대 끝의 값. 라벨은 막대 폭이 아니라 칸 폭을 쓰므로 잘리지 않는다.
  const barLabel = (props: LabelProps) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const width = Number(props.width ?? 0);
    const height = Number(props.height ?? 0);
    const value = Number(props.value ?? 0);
    const top = Math.min(y, y + height);
    const bottom = Math.max(y, y + height);
    return (
      <text key={`bar-label-${String(props.index)}`} x={x + width / 2} y={value >= 0 ? top - 8 : bottom + 16} textAnchor="middle" fill="var(--text-primary)" fontSize={12} fontWeight={600}>
        {won(value)}
      </text>
    );
  };

  const tableHead = (
    <thead>
      <tr><th>날짜</th><th>판매가</th><th>매입가</th><th>수익</th><th>매입가 미입력</th></tr>
    </thead>
  );

  return (
    <div className="viz-root">
      <style>{VIZ_CSS}</style>

      <div className="viz-tiles">
        {SERIES.map((s) => (
          <div key={s.key} className="viz-tile">
            <span className="viz-tile-label"><Key color={s.color} kind="box" />총 {s.name}</span>
            <span className="viz-tile-value">{won(s.key === 'sales' ? totals.salesTotal : s.key === 'purchase' ? totals.purchaseTotal : totals.profitTotal)}</span>
          </div>
        ))}
      </div>
      {(totals.missingPrice > 0 || totals.partialSales > 0) && (
        <p className="ak-sub" style={{ margin: 0 }}>
          {totals.missingPrice > 0 && <>매입가 미입력 <strong>{totals.missingPrice}건</strong>은 수익과 총 수익에서 뺐습니다. </>}
          {totals.partialSales > 0 && <>판매가를 일부만 입력한 품목 {totals.partialSales}건은 총 판매가가 덜 잡혔습니다.</>}
        </p>
      )}

      <div className="viz-views" role="group" aria-label="그래프 보기">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" className={`viz-view-btn ${view === v.key ? 'is-on' : ''}`} aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.name}</button>
        ))}
      </div>

      {view !== 'all' && <GroupChart key={view} groups={view === 'product' ? byProduct : bySeller} kind={view} periodLabel={periodLabel} />}

      {view === 'all' && (
      <section className="viz-card" aria-label="정산 그래프">
        <div className="viz-head">
          <span className="viz-title">{isDay ? `${series[0].label} (${series[0].weekday}) 판매가·매입가·수익 비교` : `일별 판매가·매입가·수익 추이`}</span>
          <span className="viz-sub">{isDay ? '하루의 세 값을 나란히 비교합니다' : `${periodLabel} · 단위 원`}</span>
        </div>

        {empty ? (
          <p className="viz-empty">이 기간에 입력된 판매·매입 내역이 없습니다.</p>
        ) : (
          <>
            <Legend kind={isDay ? 'box' : 'line'} />
            <div role="img" aria-label={summary} style={{ width: '100%', height: isDay ? BAR_H : LINE_H }}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: isDay ? BAR_H : LINE_H }}>
                {isDay ? (
                  <BarChart data={bars} margin={{ top: 28, right: 16, bottom: 4, left: 4 }} barCategoryGap="30%">
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 13 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickMargin={8} />
                    <YAxis width={52} domain={[barScale.min, barScale.max]} ticks={barScale.ticks} tickFormatter={barAxis} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} />
                    {barScale.min < 0 && <ReferenceLine y={0} stroke="var(--axis)" />}
                    <Tooltip content={BarTooltip} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
                    <Bar dataKey="value" barSize={BAR_THICK} shape={barShape} label={barLabel} isAnimationActive={false} onMouseEnter={(_, index) => setHoverBar(index)} onMouseLeave={() => setHoverBar(null)} />
                  </BarChart>
                ) : (
                  <LineChart data={series} margin={{ ...LINE_MARGIN, right: showEndLabels ? 56 : 16 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="label" height={X_AXIS_H} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
                    <YAxis width={52} domain={[lineScale.min, lineScale.max]} ticks={lineScale.ticks} tickFormatter={lineAxis} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    {lineScale.min < 0 && <ReferenceLine y={0} stroke="var(--axis)" />}
                    <Tooltip content={LineTooltip} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
                    {SERIES.map((s) => (
                      <Line
                        key={s.key}
                        dataKey={s.key}
                        name={s.name}
                        type="linear"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive={false}
                        dot={(p: DotItemDotProps) =>
                          p.index === lastIndex ? <circle key={`dot-${s.key}`} cx={p.cx} cy={p.cy} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} /> : <g key={`dot-${s.key}-${String(p.index)}`} />
                        }
                        activeDot={{ r: 4, fill: s.color, stroke: 'var(--surface-1)', strokeWidth: 2 }}
                        label={
                          showEndLabels
                            ? (p: LabelProps) =>
                                p.index === lastIndex ? (
                                  <text key={`end-${s.key}`} x={Number(p.x ?? 0) + 10} y={Number(p.y ?? 0)} dy={4} fill="var(--text-secondary)" fontSize={12}>{s.name}</text>
                                ) : (
                                  <g key={`end-${s.key}-${String(p.index)}`} />
                                )
                            : false
                        }
                      />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>

            <details className="viz-table-wrap">
              <summary>표로 보기</summary>
              <div className="viz-table-scroll">
                <table className="viz-table">
                  {tableHead}
                  <tbody>
                    {series.map((p) => (
                      <tr key={p.date}>
                        <td>{p.label} ({p.weekday})</td>
                        <td>{formatWon(p.sales)}</td>
                        <td>{formatWon(p.purchase)}</td>
                        <td>{formatWon(p.profit)}</td>
                        <td>{p.missingPrice > 0 ? `${p.missingPrice}건` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {series.length > 1 && (
                    <tfoot>
                      <tr>
                        <td>합계</td>
                        <td>{formatWon(totals.salesTotal)}</td>
                        <td>{formatWon(totals.purchaseTotal)}</td>
                        <td>{formatWon(totals.profitTotal)}</td>
                        <td>{totals.missingPrice > 0 ? `${totals.missingPrice}건` : '-'}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </details>
          </>
        )}
      </section>
      )}
    </div>
  );
}
