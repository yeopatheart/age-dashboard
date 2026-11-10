// 리포트 추이 차트의 가로축 구간(버킷). 기간 단위가 일·주·월이면 하루씩, 년이면 한 달씩 쪼갠다. 날짜는 모두 "YYYY-MM-DD" 문자열이다.
import type { Granularity } from '../report.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export interface Bucket {
  key: string; // 일별은 날짜, 월별은 YYYY-MM
  label: string; // 가로축에 쓰는 짧은 이름(일별 11.07, 월별 11월)
  from: string;
  to: string;
}

const MAX_DAYS = 400; // 잘못된 기간으로 무한히 늘어나지 않게

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end && out.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export const bucketUnit = (granularity: Granularity): 'day' | 'month' => (granularity === 'year' ? 'month' : 'day');

// 날짜가 속한 버킷의 key.
export const bucketKeyOf = (date: string, granularity: Granularity): string => (granularity === 'year' ? date.slice(0, 7) : date);

// 기간(from~to)을 버킷으로 나눈다. 데이터가 없는 구간도 포함해서 가로축이 끊기지 않게 한다.
export function bucketsOf(granularity: Granularity, period: { from: string; to: string }): Bucket[] {
  if (granularity === 'year') {
    const year = period.from.slice(0, 4);
    return Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0');
      const last = new Date(Date.UTC(Number(year), i + 1, 0)).getUTCDate();
      return { key: `${year}-${m}`, label: `${i + 1}월`, from: `${year}-${m}-01`, to: `${year}-${m}-${String(last).padStart(2, '0')}` };
    });
  }
  return eachDate(period.from, period.to).map((date) => ({ key: date, label: date.slice(5).replace('-', '.'), from: date, to: date }));
}
