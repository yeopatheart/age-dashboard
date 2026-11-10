// 박스 사용량 집계(순수 함수). 한 줄 = 제출한 박스 한 개(packing_boxes). 박스 이름은 제출 시점의 복사본이라 박스를 지워도 집계된다.
// "영업일"은 그 기간에 박스가 한 개라도 제출된 날이다(평균은 쉬는 날을 빼고 구한다).
import type { Granularity } from '../report.ts';
import { bucketKeyOf, type Bucket } from './buckets.ts';

export interface BoxUseRow {
  orderDate: string; // 출고일
  boxName: string;
  businessName: string;
  terminalName: string | null;
}

export interface BoxTypeStat {
  boxName: string;
  count: number;
  share: number; // 0~1
  perDayAvg: number; // 영업일 평균
  peak: { date: string; count: number };
  weekday: (number | null)[]; // 월~일(0~6) 평균 개수. 그 요일에 영업일이 없으면 null
}

export interface BoxUsage {
  total: number;
  activeDays: number;
  dailyAvg: number; // 영업일 평균(전체 박스)
  peak: { date: string; count: number } | null;
  byType: BoxTypeStat[]; // 많이 쓴 순
  series: { bucket: Bucket; counts: Record<string, number> }[]; // 버킷마다 박스 종류별 개수
  topBusinesses: { name: string; count: number }[];
  topTerminals: { name: string; count: number }[];
}

// 월요일=0 … 일요일=6.
export const weekdayIndex = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
export const WEEKDAY_LABEL = ['월', '화', '수', '목', '금', '토', '일'];

const round1 = (n: number) => Math.round(n * 10) / 10;

function topN(rows: BoxUseRow[], pick: (r: BoxUseRow) => string, n: number): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')).slice(0, n);
}

export function summarizeBoxUsage(rows: BoxUseRow[], buckets: Bucket[], granularity: Granularity, topLimit = 10): BoxUsage {
  const total = rows.length;
  const perDay = new Map<string, number>(); // 날짜 → 전체 박스 수
  const perTypeDay = new Map<string, Map<string, number>>(); // 박스 종류 → 날짜 → 개수
  for (const r of rows) {
    perDay.set(r.orderDate, (perDay.get(r.orderDate) ?? 0) + 1);
    const days = perTypeDay.get(r.boxName) ?? new Map<string, number>();
    days.set(r.orderDate, (days.get(r.orderDate) ?? 0) + 1);
    perTypeDay.set(r.boxName, days);
  }
  const activeDays = perDay.size;
  const weekdayDays: number[] = Array.from({ length: 7 }, () => 0); // 요일별 영업일 수
  for (const date of perDay.keys()) weekdayDays[weekdayIndex(date)] += 1;

  let peak: BoxUsage['peak'] = null;
  for (const [date, count] of perDay) if (!peak || count > peak.count || (count === peak.count && date < peak.date)) peak = { date, count };

  const byType: BoxTypeStat[] = [...perTypeDay].map(([boxName, days]) => {
    let count = 0;
    let typePeak = { date: '', count: 0 };
    const weekdaySum = Array.from({ length: 7 }, () => 0);
    for (const [date, n] of days) {
      count += n;
      weekdaySum[weekdayIndex(date)] += n;
      if (n > typePeak.count || (n === typePeak.count && date < typePeak.date)) typePeak = { date, count: n };
    }
    return {
      boxName,
      count,
      share: total === 0 ? 0 : count / total,
      perDayAvg: activeDays === 0 ? 0 : round1(count / activeDays),
      peak: typePeak,
      weekday: weekdaySum.map((sum, i) => (weekdayDays[i] === 0 ? null : round1(sum / weekdayDays[i]))),
    };
  });
  byType.sort((a, b) => b.count - a.count || a.boxName.localeCompare(b.boxName, 'ko'));

  const series = buckets.map((bucket) => ({ bucket, counts: {} as Record<string, number> }));
  const indexByKey = new Map(series.map((s, i) => [s.bucket.key, i]));
  for (const r of rows) {
    const i = indexByKey.get(bucketKeyOf(r.orderDate, granularity));
    if (i === undefined) continue;
    series[i].counts[r.boxName] = (series[i].counts[r.boxName] ?? 0) + 1;
  }

  return {
    total,
    activeDays,
    dailyAvg: activeDays === 0 ? 0 : round1(total / activeDays),
    peak,
    byType,
    series,
    topBusinesses: topN(rows, (r) => r.businessName || '(이름 없음)', topLimit),
    topTerminals: topN(rows, (r) => r.terminalName || '미지정', topLimit),
  };
}
