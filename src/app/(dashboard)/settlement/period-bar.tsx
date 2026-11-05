'use client';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GRANULARITY_LABEL, getPeriod, shiftAnchor, type Granularity } from '@/lib/report';
import { settlementTodayUrl, settlementUrl, type SettlementTab } from '@/lib/settlement/url';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

// 판매내역·매입내역·그래프가 함께 쓰는 기간 선택 줄: 일/주/월 전환, 이전·다음 이동, 오늘. 탭은 그대로 유지한다.
export function PeriodBar({
  tab,
  granularity,
  anchor,
  today,
  periodLabel,
  trailing,
}: {
  tab: SettlementTab;
  granularity: Granularity;
  anchor: string;
  today: string;
  periodLabel: string;
  trailing?: React.ReactNode; // 줄 오른쪽 끝에 붙일 내용(예: "저장 중…")
}) {
  const prevUrl = settlementUrl(granularity, shiftAnchor(granularity, anchor, -1), tab);
  const nextAnchor = shiftAnchor(granularity, anchor, 1);
  const nextDisabled = getPeriod(granularity, nextAnchor).from > today; // 아직 오지 않은 기간으로는 못 간다

  return (
    <div className="ak-toolbar">
      <div style={{ display: 'inline-flex', gap: 4 }}>
        {GRANULARITIES.map((g) => (
          <Link key={g} href={settlementUrl(g, anchor, tab)} className={`ak-btn ${g === granularity ? 'ak-btn-primary' : ''}`}>{GRANULARITY_LABEL[g]}</Link>
        ))}
      </div>
      <Link href={prevUrl} className="ak-btn" aria-label={`이전 ${GRANULARITY_LABEL[granularity]}`}><ChevronLeft size={14} /></Link>
      <strong style={{ minWidth: '9rem', textAlign: 'center' }}>{periodLabel}</strong>
      {nextDisabled ? (
        <span className="ak-btn" aria-disabled style={{ opacity: 0.4, pointerEvents: 'none' }}><ChevronRight size={14} /></span>
      ) : (
        <Link href={settlementUrl(granularity, nextAnchor, tab)} className="ak-btn" aria-label={`다음 ${GRANULARITY_LABEL[granularity]}`}><ChevronRight size={14} /></Link>
      )}
      <Link href={settlementTodayUrl(tab)} className="ak-btn">오늘</Link>
      <span className="ak-spacer" />
      {trailing}
    </div>
  );
}
