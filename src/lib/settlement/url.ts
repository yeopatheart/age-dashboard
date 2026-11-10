// 정산 화면의 주소. 기간(?g=day|week|month, ?d=기준일)을 한 곳에서 만든다. 판매내역·매입내역·그래프는 한 화면(/settlement)이고, 영수증은 보내기 화면(/dispatch) 고객사 탭이다.
import { getPeriod, type Granularity } from '@/lib/report';

export const settlementUrl = (g: Granularity, d: string) => `/settlement?g=${g}&d=${d}`;


const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 정산 화면의 기간 읽기: ?g=day|week|month(기본 day), ?d=YYYY-MM-DD(기준일, 기본 오늘, 미래·잘못된 값은 오늘로 본다).
export function parsePeriodParams(g: string | undefined, d: string | undefined, today: string) {
  const granularity: Granularity = g === 'week' || g === 'month' ? g : 'day';
  const anchor = d && isValidDate(d) && d <= today ? d : today;
  return { granularity, anchor, period: getPeriod(granularity, anchor) };
}
