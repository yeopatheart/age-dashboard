// 차트가 같이 쓰는 작은 조각: 범례, 툴팁 틀, 표로 보기. 스타일 클래스(.viz-*)는 viz-css.ts다.
import type { ReactNode } from 'react';

export interface LegendEntry {
  key: string;
  name: string;
  color: string;
}

export function LegendKey({ color, kind }: { color: string; kind: 'line' | 'box' }) {
  return <span className={kind === 'line' ? 'viz-key-line' : 'viz-key-box'} style={{ background: color }} aria-hidden />;
}

// 범례: 막대·영역은 네모, 선은 짧은 선으로 같은 모양을 따라 쓴다. 이름은 글자색 토큰이고 색은 옆의 표시가 맡는다.
export function ChartLegend({ entries, kind }: { entries: LegendEntry[]; kind: 'line' | 'box' }) {
  return (
    <div className="viz-legend">
      {entries.map((e) => (
        <span key={e.key} className="viz-legend-item">
          <LegendKey color={e.color} kind={kind} />
          {e.name}
        </span>
      ))}
    </div>
  );
}

export interface TipRow {
  key: string;
  name: string;
  color: string;
  value: string;
}

// 툴팁: 값이 먼저 눈에 띄고 이름은 보조다. 줄 표시는 짧은 선이다.
export function TipBox({ head, rows, note }: { head: string; rows: TipRow[]; note?: string }) {
  return (
    <div className="viz-tip">
      <div className="viz-tip-head">{head}</div>
      {rows.map((r) => (
        <div key={r.key} className="viz-tip-row">
          <LegendKey color={r.color} kind="line" />
          <span className="viz-tip-name">{r.name}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
      {note && <div className="viz-tip-note">{note}</div>}
    </div>
  );
}

// 표로 보기: 색 대비가 낮은 항목이 있어도 모든 값을 읽을 수 있게 한다(차트의 값을 그대로 표로).
export function TableView({ summary = '표로 보기', head, rows, foot }: { summary?: string; head: string[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  return (
    <details className="viz-table-wrap">
      <summary>{summary}</summary>
      <div className="viz-table-scroll">
        <table className="viz-table">
          <thead>
            <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
          {foot && (
            <tfoot>
              <tr>{foot.map((c, j) => <td key={j}>{c}</td>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </details>
  );
}
