'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { axisFormatter, niceScale } from '@/lib/settlement/chart';
import { sortGroups, topGroups, type GroupPoint, type GroupSortKey } from '@/lib/settlement/chart-groups';
import { formatWon } from '@/lib/money';
import { Key, Legend, SERIES, won } from './chart-shared';

// 품목별·사업자별 그래프: 항목마다 판매가·매입가·수익 막대 세 개를 가로로 나란히 둔다(이름이 길어도 읽히게 가로 막대).
// 품목은 많을 수 있어 선택한 값이 큰 TOP_N개만 그리고 나머지는 "기타"로 묶는다. 전체 목록은 표로 본다.
const TOP_N = 10;
const ROW_PX = 58; // 항목 하나(막대 세 개)의 높이
const LABEL_W = 88;
const SORTS: { key: GroupSortKey; name: string }[] = [
  { key: 'sales', name: '판매가' },
  { key: 'purchase', name: '매입가' },
  { key: 'profit', name: '수익' },
];

const short = (name: string) => (name.length > 7 ? `${name.slice(0, 6)}…` : name);

function GroupTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as GroupPoint;
  return (
    <div className="viz-tip">
      <div className="viz-tip-head">{p.name}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="viz-tip-row">
          <Key color={s.color} kind="box" />
          <span className="viz-tip-name">{s.name}</span>
          <strong>{won(p[s.key])}</strong>
        </div>
      ))}
      {p.missingPrice > 0 && <div className="viz-tip-note">매입가 미입력 {p.missingPrice}건</div>}
    </div>
  );
}

export function GroupChart({ groups, kind, periodLabel }: { groups: GroupPoint[]; kind: 'product' | 'seller'; periodLabel: string }) {
  const [sortKey, setSortKey] = useState<GroupSortKey>('sales');
  const noun = kind === 'product' ? '품목' : '사업자';
  const { shown, rest } = topGroups(groups, sortKey, TOP_N);
  const data = rest ? [...shown, rest] : shown;
  const scale = niceScale(data.flatMap((g) => SERIES.map((s) => g[s.key])));
  const axis = axisFormatter(scale.max);
  const height = data.length * ROW_PX + 44;
  const all = sortGroups(groups, sortKey);
  const sum = (key: GroupSortKey | 'missingPrice') => groups.reduce((s, g) => s + g[key], 0);
  const missing = sum('missingPrice');
  const summary = `${periodLabel} ${noun}별 판매가·매입가·수익`;

  return (
    <section className="viz-card" aria-label={`${noun}별 그래프`}>
      <div className="viz-head">
        <span className="viz-title">{noun}별 판매가·매입가·수익</span>
        <span className="viz-sub">{periodLabel} · 단위 원{kind === 'product' ? ` · ${SORTS.find((s) => s.key === sortKey)?.name} 큰 순서 상위 ${TOP_N}개` : ''}</span>
      </div>

      {data.length === 0 ? (
        <p className="viz-empty">이 기간에 입력된 판매·매입 내역이 없습니다.</p>
      ) : (
        <>
          <div className="viz-controls">
            <Legend kind="box" />
            <div className="viz-seg" role="group" aria-label="정렬 기준">
              <span className="viz-seg-label">정렬</span>
              {SORTS.map((s) => (
                <button key={s.key} type="button" className={`viz-seg-btn ${sortKey === s.key ? 'is-on' : ''}`} aria-pressed={sortKey === s.key} onClick={() => setSortKey(s.key)}>{s.name}</button>
              ))}
            </div>
          </div>
          <div role="img" aria-label={summary} style={{ width: '100%', height }}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height }}>
              <BarChart layout="vertical" data={data} margin={{ top: 4, right: 20, bottom: 4, left: 4 }} barCategoryGap="22%" barGap={2}>
                <CartesianGrid stroke="var(--grid)" horizontal={false} />
                <XAxis type="number" domain={[scale.min, scale.max]} ticks={scale.ticks} tickFormatter={axis} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickMargin={6} />
                <YAxis type="category" dataKey="name" width={LABEL_W} tickFormatter={short} interval={0} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} />
                {scale.min < 0 && <ReferenceLine x={0} stroke="var(--axis)" />}
                <Tooltip content={GroupTooltip} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
                {SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {rest && <p className="viz-sub" style={{ margin: 0 }}>상위 {TOP_N}개 외 {noun} {rest.name.replace(/\D/g, '')}개는 &ldquo;{rest.name}&rdquo;로 묶었습니다. 전체는 아래 표에서 볼 수 있습니다.</p>}
          {kind === 'seller' && (
            <p className="viz-sub" style={{ margin: 0 }}>
              판매가는 판매내역의 사업자 구분, 매입가는 매입내역의 사업자 구분으로 각각 합쳤고, 수익은 사업자별 (판매가 − 매입가)입니다. &ldquo;미지정&rdquo;은 사업자 구분을 고르지 않은 건입니다.
              {missing > 0 && <> 매입가 미입력 {missing}건은 아직 반영되지 않아 수익이 크게 보일 수 있습니다.</>}
            </p>
          )}

          <details className="viz-table-wrap">
            <summary>표로 보기 ({groups.length}개)</summary>
            <div className="viz-table-scroll">
              <table className="viz-table">
                <thead>
                  <tr><th>{noun}</th><th>판매가</th><th>매입가</th><th>수익</th><th>매입가 미입력</th></tr>
                </thead>
                <tbody>
                  {all.map((g) => (
                    <tr key={g.key}>
                      <td>{g.name}</td>
                      <td>{formatWon(g.sales)}</td>
                      <td>{formatWon(g.purchase)}</td>
                      <td>{formatWon(g.profit)}</td>
                      <td>{g.missingPrice > 0 ? `${g.missingPrice}건` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>합계</td>
                    <td>{formatWon(sum('sales'))}</td>
                    <td>{formatWon(sum('purchase'))}</td>
                    <td>{formatWon(sum('profit'))}</td>
                    <td>{missing > 0 ? `${missing}건` : '-'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
