// 하나의 전체를 여러 부분으로 나눈 가로 막대(높이 28px). 폭이 값에 비례하고, 글자가 들어갈 만큼 넓은 칸에만 비율을 적는다(넘치면 적지 않고 표에서 본다).
import { inkOn } from './palette';

export interface SegPart {
  key: string;
  name: string;
  value: number;
  color: string;
}

export function SegmentedBar({ parts, total, ariaLabel }: { parts: SegPart[]; total: number; ariaLabel: string }) {
  if (total <= 0) return null;
  const summary = parts.filter((p) => p.value > 0).map((p) => `${p.name} ${p.value}건 (${Math.round((p.value / total) * 100)}%)`).join(', ');
  return (
    <div role="img" aria-label={`${ariaLabel}: ${summary}`} style={{ display: 'flex', gap: 2, height: 28, width: '100%' }}>
      {parts.filter((p) => p.value > 0).map((p) => {
        const share = p.value / total;
        return (
          <div
            key={p.key}
            title={`${p.name} ${p.value}건 (${Math.round(share * 100)}%)`}
            style={{ flex: `${p.value} 0 0`, minWidth: 2, background: p.color, borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 8, color: inkOn(p.color), fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'clip' }}
          >
            {share >= 0.1 ? `${Math.round(share * 100)}%` : ''}
          </div>
        );
      })}
    </div>
  );
}
