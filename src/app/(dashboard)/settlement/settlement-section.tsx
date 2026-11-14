'use client';
import { useState, type ReactNode } from 'react';
import { useIsMobile } from '@/lib/use-is-mobile';

// 정산 화면의 한 구역(판매내역·매입내역). 제목을 눌러 접고 펼 수 있다.
// 휴대폰에서는 화면이 너무 길어지지 않게 openOnMobile이 아닌 구역을 처음에 접어 둔다(사용자가 펼치거나 접은 상태는 날짜를 옮겨도 유지된다).
// 넓은 화면에서는 모두 펼쳐 둔다. id는 넓은 화면에서 구역을 배치하는 CSS(.ak-split)가 쓴다.
export function SettlementSection({ id, title, hint, openOnMobile = false, children }: { id: 'purchases' | 'sales' | 'shipping'; title: string; hint?: string; openOnMobile?: boolean; children: ReactNode }) {
  const isMobile = useIsMobile();
  const [chosen, setChosen] = useState<boolean | null>(null); // null = 사용자가 아직 누르지 않음 → 기기 기본값
  const open = chosen ?? (isMobile ? openOnMobile : true);
  return (
    <details open={open} onToggle={(e) => setChosen(e.currentTarget.open)} className={`ak-section ak-section-${id}`}>
      <summary className="ak-section-head">
        <span className="ak-section-title">{title}</span>
        {hint && <span className="ak-sub">{hint}</span>}
      </summary>
      <div className="ak-section-body">{children}</div>
    </details>
  );
}
