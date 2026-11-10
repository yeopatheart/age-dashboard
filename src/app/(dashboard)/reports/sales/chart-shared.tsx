import { formatWon } from '@/lib/money';

// 정산 그래프(전체·품목별·사업자별)가 같이 쓰는 항목 정의와 작은 조각. 색은 항목마다 고정이다(판매가=1번, 매입가=2번, 수익=3번 슬롯).
export const SERIES = [
  { key: 'sales', name: '판매가', color: 'var(--series-1)' },
  { key: 'purchase', name: '매입가', color: 'var(--series-2)' },
  { key: 'profit', name: '수익', color: 'var(--series-3)' },
] as const;

export const won = (n: number) => `${formatWon(n)}원`;

export function Key({ color, kind }: { color: string; kind: 'line' | 'box' }) {
  return <span className={kind === 'line' ? 'viz-key-line' : 'viz-key-box'} style={{ background: color }} aria-hidden />;
}

export function Legend({ kind }: { kind: 'line' | 'box' }) {
  return (
    <div className="viz-legend">
      {SERIES.map((s) => (
        <span key={s.key} className="viz-legend-item"><Key color={s.color} kind={kind} />{s.name}</span>
      ))}
    </div>
  );
}
