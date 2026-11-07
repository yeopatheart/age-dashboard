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
  basePath = '/settlement',
}: {
  granularity: Granularity;
  anchor: string;
  today: string;
  periodLabel: string;
  basePath?: string; // 기간 이동이 가는 화면(정산 /settlement, 영수증 /receipts)
}) {
  const prevUrl = settlementUrl(granularity, shiftAnchor(granularity, anchor, -1), basePath);
  const nextAnchor = shiftAnchor(granularity, anchor, 1);
  const nextDisabled = getPeriod(granularity, nextAnchor).from > today; // 아직 오지 않은 기간으로는 못 간다

  return (
    <div className="ak-toolbar ak-sticky ak-period-bar">
      <div className="ak-period-seg">
        {GRANULARITIES.map((g) => (
          <Link key={g} href={settlementUrl(g, anchor, basePath)} className={`ak-btn ${g === granularity ? 'ak-btn-primary' : ''}`}>{GRANULARITY_LABEL[g]}</Link>
        ))}
      </div>
      <div className="ak-period-nav">
        <Link href={prevUrl} className="ak-btn ak-period-icon" aria-label={`이전 ${GRANULARITY_LABEL[granularity]}`}><ChevronLeft size={14} /></Link>
        <strong className="ak-period-label">{periodLabel}</strong>
        {nextDisabled ? (
          <span className="ak-btn ak-period-icon" aria-disabled style={{ opacity: 0.4, pointerEvents: 'none' }}><ChevronRight size={14} /></span>
        ) : (
          <Link href={settlementUrl(granularity, nextAnchor, basePath)} className="ak-btn ak-period-icon" aria-label={`다음 ${GRANULARITY_LABEL[granularity]}`}><ChevronRight size={14} /></Link>
        )}
        <Link href={settlementTodayUrl(basePath)} className="ak-btn ak-period-today">오늘</Link>
      </div>
    </div>
  );
}
