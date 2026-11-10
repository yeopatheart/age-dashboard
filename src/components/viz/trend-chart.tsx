'use client';
// 비율 추이(0~100%) 선 차트 + 그 아래 건수 막대. 축은 하나만 쓴다(비율과 건수는 서로 다른 단위라 두 차트로 나눈다).
// 건수가 없는 구간은 값이 null이라 선이 끊긴다(0%로 그리지 않는다). 선 2px, 점 지름 8px에 표면색 2px 고리.
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TipBox, type LegendEntry } from './parts';

export interface TrendDatum {
  label: string;
  tipHead: string;
  count: number; // 그 구간의 건수
  [seriesKey: string]: string | number | null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function TrendChart({ data, series, countLabel = '제출 건수' }: { data: TrendDatum[]; series: LegendEntry[]; countLabel?: string }) {
  const shared = { data, margin: { top: 12, right: 8, bottom: 4, left: 0 } };
  const xAxis = (
    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={14} />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ width: '100%', height: 240 }} role="img" aria-label={`${series.map((s) => s.name).join(', ')} 추이`}>
        <ResponsiveContainer>
          <LineChart {...shared}>
            <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
            {xAxis}
            <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={pct} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload as TrendDatum;
                const rows = series.map((s) => ({ key: s.key, name: s.name, color: s.color, value: d[s.key] === null ? '-' : pct(Number(d[s.key])) }));
                return <TipBox head={d.tipHead} rows={rows} note={`${countLabel} ${d.count}건`} />;
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls={false}
                dot={{ r: 4, fill: s.color, stroke: 'var(--surface-1)', strokeWidth: 2 }}
                activeDot={{ r: 5, fill: s.color, stroke: 'var(--surface-1)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ width: '100%', height: 72 }} role="img" aria-label={countLabel}>
        <ResponsiveContainer>
          <BarChart {...shared} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            {xAxis}
            <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickCount={3} />
            <Tooltip cursor={{ fill: 'var(--hover)' }} content={() => null} />
            <Bar dataKey="count" fill="var(--text-muted)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="viz-sub" style={{ textAlign: 'center' }}>↑ 비율 · ↓ {countLabel}</div>
    </div>
  );
}
