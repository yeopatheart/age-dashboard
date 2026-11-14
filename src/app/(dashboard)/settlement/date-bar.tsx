'use client';
import { useRouter } from 'next/navigation';
import { settlementUrl } from '@/lib/settlement/url';
import { DateNav } from '@/components/date-nav';

// 정산이 쓰는 날짜 선택 줄: [‹ 날짜 › 오늘]. 모양은 공용 컨트롤(date-nav.tsx)이다. 스크롤해도 위에 붙어 있다.
export function DateBar({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  return (
    <div className="ak-toolbar ak-sticky ak-period-bar">
      <DateNav value={date} today={today} grow label="정산 날짜" onChange={(d) => router.push(settlementUrl(d))} />
    </div>
  );
}
