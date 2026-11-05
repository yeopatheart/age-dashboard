import type { ReactNode } from 'react';

// 정산 화면의 한 구역(그래프·매입내역·판매내역). 제목을 눌러 접고 펼 수 있다(기본은 펼침, JS 없이 details로 처리).
// id는 넓은 화면에서 구역을 배치하는 CSS(.ak-split)가 쓴다.
export function SettlementSection({ id, title, hint, children }: { id: 'chart' | 'purchases' | 'sales'; title: string; hint?: string; children: ReactNode }) {
  return (
    <details open className={`ak-section ak-section-${id}`}>
      <summary className="ak-section-head">
        <span className="ak-section-title">{title}</span>
        {hint && <span className="ak-sub">{hint}</span>}
      </summary>
      <div className="ak-section-body">{children}</div>
    </details>
  );
}
