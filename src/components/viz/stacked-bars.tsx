'use client';
// 쌓은 막대 차트(버킷마다 항목별 개수). 막대 두께는 24px 이하, 맨 위 조각만 위쪽 모서리 4px를 둥글게 하고, 조각 사이는 표면색 2px 틈으로 나눈다.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TipBox, type LegendEntry } from './parts';

export interface StackDatum {
  label: string; // 가로축 이름
  tipHead: string; // 툴팁 머리글(예: 11.07 (금))
  [seriesKey: string]: string | number;
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: StackDatum;
}

const GAP = 2;

// 한 조각을 그린다. 이 조각 위에 더 쌓인 조각이 없으면(맨 위 조각) 위쪽 모서리를 둥글게 한다.
function StackShape({ x = 0, y = 0, width = 0, height = 0, fill, payload, keys, index }: ShapeProps & { keys: string[]; index: number }) {
  if (height <= 0 || width <= 0) return <g />;
  const isTop = !payload || keys.slice(index + 1).every((k) => !Number(payload[k]));
  const r = isTop ? Math.min(4, width / 2, height) : 0;
  const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
  return <path d={d} fill={fill} stroke="var(--surface-1)" strokeWidth={GAP} />;
}

export function StackedBars({ data, series, height = 280, unit = '개' }: { data: StackDatum[]; series: LegendEntry[]; height?: number; unit?: string }) {
  const keys = series.map((s) => s.key);
  return (
    <div style={{ width: '100%', height }} role="img" aria-label={`${series.map((s) => s.name).join(', ')}별 ${unit} 수 추이`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const datum = payload[0].payload as StackDatum;
              const rows = series.filter((s) => Number(datum[s.key]) > 0).map((s) => ({ key: s.key, name: s.name, color: s.color, value: `${Number(datum[s.key]).toLocaleString('en-US')}${unit}` }));
              const total = series.reduce((sum, s) => sum + (Number(datum[s.key]) || 0), 0);
              return <TipBox head={datum.tipHead} rows={rows} note={`합계 ${total.toLocaleString('en-US')}${unit}`} />;
            }}
          />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} maxBarSize={24} shape={(raw: unknown) => <StackShape {...(raw as ShapeProps)} keys={keys} index={i} />} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
