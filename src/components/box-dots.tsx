import type { BoxState } from '@/lib/overview';

// 박스 번호별 라벨 상태를 점 하나씩으로 보여준다: ○ 라벨 미출력 · 파란 ● 라벨 출력됨 · 초록 ● 상차 완료.
// 대시보드(현황)와 주문 목록 카드가 같은 모양을 쓴다.
const TEXT: Record<BoxState, string> = { none: '라벨 미출력', printed: '라벨 출력', loaded: '상차 완료' };

export function BoxDots({ states }: { states: BoxState[] }) {
  if (states.length === 0) return null;
  return (
    <span className="bd-root" role="img" aria-label={states.map((s, i) => `박스 ${i + 1} ${TEXT[s]}`).join(', ')}>
      {states.map((s, i) => (
        <i key={i} className={`bd-dot bd-${s}`} title={`박스 ${i + 1}번 · ${TEXT[s]}`} />
      ))}
      <style>{`
        .bd-root { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .bd-dot { display: block; width: 12px; height: 12px; border-radius: 999px; border: 2px solid #cbd5e1; background: #fff; box-sizing: border-box; }
        .bd-printed { border-color: #3b82f6; background: #3b82f6; }
        .bd-loaded { border-color: #16a34a; background: #16a34a; }
      `}</style>
    </span>
  );
}
