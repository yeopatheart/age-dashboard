'use client';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GRANULARITY_LABEL, getPeriod, shiftAnchor, type Granularity } from '@/lib/report';
import { settlementTodayUrl, settlementUrl } from '@/lib/settlement/url';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

// 판매내역·매입내역·그래프가 한 화면에서 함께 쓰는 기간 선택 줄: 일/주/월 전환, 이전·다음 이동, 오늘. 스크롤해도 위에 붙어 있다.
export function PeriodBar({
  granularity,
  anchor,
  today,
  periodLabel,
}: {
  granularity: Granularity;
  anchor: string;
  today: string;
  periodLabel: string;
}) {
  const prevUrl = settlementUrl(granularity, shiftAnchor(granularity, anchor, -1));
  const nextAnchor = shiftAnchor(granularity, anchor, 1);
  const nextDisabled = getPeriod(granularity, nextAnchor).from > today; // 아직 오지 않은 기간으로는 못 간다

  return (
    <div className="ak-toolbar ak-sticky">
      <div style={{ display: 'inline-flex', gap: 4 }}>
        {GRANULARITIES.map((g) => (
          <Link key={g} href={settlementUrl(g, anchor)} className={`ak-btn ${g === granularity ? 'ak-btn-primary' : ''}`}>{GRANULARITY_LABEL[g]}</Link>
        ))}
      </div>
      <Link href={prevUrl} className="ak-btn" aria-label={`이전 ${GRANULARITY_LABEL[granularity]}`}><ChevronLeft size={14} /></Link>
      <strong style={{ minWidth: '9rem', textAlign: 'center' }}>{periodLabel}</strong>
      {nextDisabled ? (
        <span className="ak-btn" aria-disabled style={{ opacity: 0.4, pointerEvents: 'none' }}><ChevronRight size={14} /></span>
      ) : (
        <Link href={settlementUrl(granularity, nextAnchor)} className="ak-btn" aria-label={`다음 ${GRANULARITY_LABEL[granularity]}`}><ChevronRight size={14} /></Link>
      )}
      <Link href={settlementTodayUrl()} className="ak-btn">오늘</Link>
    </div>
  );
}
