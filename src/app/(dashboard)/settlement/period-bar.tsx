'use client';
import { useRouter } from 'next/navigation';
import { GRANULARITY_LABEL, type Granularity } from '@/lib/report';
import { settlementUrl } from '@/lib/settlement/url';
import { PeriodNav } from '@/components/date-nav';
import { Segmented } from '@/components/segmented';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

// 정산이 쓰는 기간 선택 줄: [일 주 월] + [‹ 기간 › 오늘]. 모양은 공용 컨트롤(date-nav.tsx · segmented.tsx)이다. 스크롤해도 위에 붙어 있다.
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
  const router = useRouter();
  return (
    <div className="ak-toolbar ak-sticky ak-period-bar">
      <Segmented label="기간 단위" value={granularity} items={GRANULARITIES.map((g) => ({ key: g, label: GRANULARITY_LABEL[g], href: settlementUrl(g, anchor) }))} />
      <PeriodNav granularity={granularity} anchor={anchor} today={today} periodLabel={periodLabel} grow onChange={(d) => router.push(settlementUrl(granularity, d))} />
    </div>
  );
}
