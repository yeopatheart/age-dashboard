// 리포트 기간 계산과 집계 결과(report_summary RPC) 모양. 날짜는 모두 "YYYY-MM-DD" 문자열(KST 기준)로 다루고
// 시간대 변환 없이 UTC 날짜 연산만 쓴다 — 문자열 날짜끼리의 덧셈/뺄셈이라 시간대에 흔들리지 않는다.
export type Granularity = 'day' | 'week' | 'month' | 'year';

export const GRANULARITY_LABEL: Record<Granularity, string> = { day: '일', week: '주', month: '월', year: '년' };

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

export function getPeriod(granularity: Granularity, anchor: string): { from: string; to: string; label: string } {
  const d = toDate(anchor);
  if (granularity === 'day') return { from: anchor, to: anchor, label: anchor.replace(/-/g, '.') };
  if (granularity === 'week') {
    const dow = (d.getUTCDay() + 6) % 7; // 월요일=0
    const from = addDays(anchor, -dow);
    const to = addDays(from, 6);
    return { from, to, label: `${from.replace(/-/g, '.')} ~ ${to.slice(5).replace('-', '.')}` };
  }
  if (granularity === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { from, to: fmt(last), label: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월` };
  }
  const y = d.getUTCFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}년` };
}

// 한 기간 앞/뒤로 옮긴 기준일.
export function shiftAnchor(granularity: Granularity, anchor: string, direction: 1 | -1): string {
  const d = toDate(anchor);
  if (granularity === 'day') return addDays(anchor, direction);
  if (granularity === 'week') return addDays(anchor, 7 * direction);
  if (granularity === 'month') return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 1)));
  return fmt(new Date(Date.UTC(d.getUTCFullYear() + direction, 0, 1)));
}

export interface UnitRow { name: string; unit: string; qty: number; extra_kg: number; unshipped: number }
export interface ReportSummary {
  products: UnitRow[];
  product_stats: { name: string; days: number; businesses: number }[];
  business_units: (UnitRow & { terminal: string; lines: number })[];
  business_stats: { name: string; terminal: string; days: number; boxes: number }[];
  terminal_units: (UnitRow & { lines: number })[];
  terminal_stats: { name: string; days: number; businesses: number; boxes: number }[];
}
