// 정산 그래프용 순수 함수: 일별 집계, 축 눈금, 금액 축 표기. 숫자의 정의는 매입내역 요약 줄과 같다(purchases.ts의 totalsOf):
//  - 판매가: 그날 판매내역에 입력된 판매가 합계(모든 품목)
//  - 매입가: 그날 매입내역에 입력된 매입가 합계
//  - 수익: 매입가를 입력한 품목만의 (총 판매가 − 매입가) 합. 매입가를 아직 안 넣은 품목은 빠지므로 판매가 − 매입가와 다를 수 있다(missingPrice로 알려 준다).
import { totalsOf, type PurchaseRow } from './purchases';

export interface DayPoint {
  date: string; // YYYY-MM-DD
  label: string; // MM.DD
  weekday: string; // 월·화·…
  sales: number;
  purchase: number;
  profit: number;
  rows: number; // 그날의 매입내역 품목 수
  missingPrice: number; // 그날 매입가 미입력 품목 수
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_DAYS = 400; // 잘못된 기간으로 무한히 늘어나지 않게

// from~to(포함)의 모든 날짜. 판매가 없는 날도 0으로 채워 가로축이 끊기지 않게 한다.
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end && out.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export function buildDailySeries(rows: PurchaseRow[], from: string, to: string): DayPoint[] {
  const byDate = new Map<string, PurchaseRow[]>();
  for (const r of rows) byDate.set(r.orderDate, [...(byDate.get(r.orderDate) ?? []), r]);
  return eachDate(from, to).map((date) => {
    const t = totalsOf(byDate.get(date) ?? []);
    return {
      date,
      label: date.slice(5).replace('-', '.'),
      weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()],
      sales: t.salesTotal,
      purchase: t.purchaseTotal,
      profit: t.profitTotal,
      rows: t.rows,
      missingPrice: t.missingPrice,
    };
  });
}

export interface AxisScale {
  min: number;
  max: number;
  ticks: number[];
}

// 세로축: 0을 반드시 포함하고(막대·선의 기준선) 1·2·5 × 10^k 간격의 깔끔한 눈금을 만든다. 값이 모두 0이면 0~5만.
// negativeLabelRoom: 막대 끝에 값을 적는 그래프용. 음수 막대의 값 라벨은 막대 아래에 놓이므로, 가장 낮은 값이 축 맨 아래에 바짝 붙어 있으면 한 칸 더 내려서 라벨이 축선·눈금 글자와 겹치지 않게 한다.
export function niceScale(values: number[], tickTarget = 5, negativeLabelRoom = false): AxisScale {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  if (hi === 0 && lo === 0) return { min: 0, max: 50000, ticks: [0, 10000, 20000, 30000, 40000, 50000] };
  const raw = (hi - lo) / tickTarget;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  let min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  if (negativeLabelRoom && lo < 0 && lo - min < step * 0.35) min -= step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return { min, max, ticks };
}

const trim = (n: number) => String(Math.round(n * 10) / 10);

// 세로축 눈금 표기: 축이 1만 이상이면 만·억으로 줄여 쓰고(예: 50만), 그보다 작으면 그대로 쓴다. 한 축에서는 한 가지 방식만 쓴다.
export function axisFormatter(max: number): (n: number) => string {
  return (n) => {
    if (n === 0) return '0';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (max >= 1e8) return `${sign}${trim(a / 1e8)}억`;
    if (max >= 1e4) return `${sign}${trim(a / 1e4)}만`;
    return `${sign}${a.toLocaleString('en-US')}`;
  };
}
