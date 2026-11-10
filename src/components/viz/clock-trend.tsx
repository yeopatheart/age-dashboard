'use client';
// 시각(시:분) 추이 선 차트. 세로축은 하루 시작(0시) 기준 분이고 눈금은 정시로 쓴다. 값이 null인 구간은 선이 끊긴다.
// 선 2px, 점 지름 8px에 표면색 2px 고리. 축은 하나(시각)만 쓴다.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatClock } from '@/lib/reports/ops-time';
import { TipBox, type LegendEntry } from './parts';

export interface ClockDatum {
  label: string; // 가로축 이름
  tipHead: string;
  note?: string; // 툴팁 아래 보조 줄(예: 카드·박스 수)
  [seriesKey: string]: string | number | null | undefined;
}

export function ClockTrend({ data, series, height = 260 }: { data: ClockDatum[]; series: LegendEntry[]; height?: number }) {
  const values = data.flatMap((d) => series.map((s) => d[s.key]).filter((v): v is number => typeof v === 'number'));
  const lo = values.length === 0 ? 0 : Math.floor(Math.min(...values) / 60) * 60;
  let hi = values.length === 0 ? 24 * 60 : Math.ceil(Math.max(...values) / 60) * 60;
  if (hi - lo < 120) hi = lo + 120;
  const step = hi - lo > 10 * 60 ? 120 : 60;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);

  return (
    <div style={{ width: '100%', height }} role="img" aria-label={`${series.map((s) => s.name).join(', ')} 시각 추이`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis domain={[lo, hi]} ticks={ticks} tickFormatter={(v: number) => formatClock(v)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={56} reversed={false} />
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as ClockDatum;
              const rows = series.map((s) => ({ key: s.key, name: s.name, color: s.color, value: typeof d[s.key] === 'number' ? formatClock(d[s.key] as number) : '-' }));
              return <TipBox head={d.tipHead} rows={rows} note={d.note} />;
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
  );
}
