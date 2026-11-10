// 미출고 분석(순수 함수). 미출고 = 주문은 유효하지만 현장에서 출고하지 못한 수량(order_items.unshipped_quantity). 주문 취소와 별개다.
// 값은 "현재 상태"다 — 이력이 없어 처음 얼마였는지는 알 수 없다.
//  - 대상 줄: 취소되지 않았고 수량이 정해진(수량 미정이 아닌) 주문 줄
//  - 미출고율 = 미출고 줄 수 ÷ 대상 줄 수, 전량 미출고 = 미출고 수량이 주문 수량 이상
import type { Granularity } from '../report.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { bucketKeyOf, type Bucket } from './buckets.ts';
import { baseCustomerName, type UnitQty } from './sales-report.ts';

export interface OrderLine {
  orderDate: string;
  customer: string;
  terminal: string;
  product: string;
  quantity: number;
  unit: string;
  unshipped: number; // 미출고 수량(0이면 정상)
  reason: string | null; // 미출고 사유(자유 텍스트)
  cancelled: boolean;
}

export const NO_REASON = '(사유 없음)';
export const MIN_LINES = 3; // 이보다 주문 줄이 적은 항목은 비율이 흔들려 "표본 부족"으로 접는다

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// 대상 줄(취소 제외, 수량 미정 제외).
export const isTarget = (l: OrderLine): boolean => !l.cancelled && !(l.quantity === 0 && !l.unit);
export const isUnshipped = (l: OrderLine): boolean => isTarget(l) && l.unshipped > 0;
export const isFullyUnshipped = (l: OrderLine): boolean => isUnshipped(l) && l.unshipped >= l.quantity;

function unitList(map: Map<string, number>): UnitQty[] {
  return [...map].map(([unit, qty]) => ({ unit, qty: round3(qty) })).sort((a, b) => a.unit.localeCompare(b.unit, 'ko'));
}

export interface UnshippedSummary {
  lines: number; // 대상 줄 수
  unshippedLines: number;
  fullLines: number; // 전량 미출고 줄 수
  rate: number | null;
  quantities: UnitQty[]; // 미출고 수량 합(단위별)
}

export function unshippedSummary(lines: OrderLine[]): UnshippedSummary {
  const target = lines.filter(isTarget);
  const unshipped = target.filter(isUnshipped);
  const qty = new Map<string, number>();
  for (const l of unshipped) qty.set(l.unit, (qty.get(l.unit) ?? 0) + l.unshipped);
  return {
    lines: target.length,
    unshippedLines: unshipped.length,
    fullLines: unshipped.filter(isFullyUnshipped).length,
    rate: target.length === 0 ? null : unshipped.length / target.length,
    quantities: unitList(qty),
  };
}

export interface UnshippedTrendPoint {
  bucket: Bucket;
  lines: number;
  unshippedLines: number;
  rate: number | null; // 대상 줄이 없으면 null(선이 끊긴다)
}

export function unshippedTrend(lines: OrderLine[], buckets: Bucket[], granularity: Granularity): UnshippedTrendPoint[] {
  const points = buckets.map((bucket) => ({ bucket, lines: 0, unshippedLines: 0 }));
  const indexByKey = new Map(points.map((p, i) => [p.bucket.key, i]));
  for (const l of lines) {
    if (!isTarget(l)) continue;
    const i = indexByKey.get(bucketKeyOf(l.orderDate, granularity));
    if (i === undefined) continue;
    points[i].lines += 1;
    if (isUnshipped(l)) points[i].unshippedLines += 1;
  }
  return points.map((p) => ({ ...p, rate: p.lines === 0 ? null : p.unshippedLines / p.lines }));
}

export interface UnshippedGroup {
  label: string;
  lines: number;
  unshippedLines: number;
  fullLines: number;
  rate: number;
  quantities: UnitQty[];
}

export interface UnshippedGroups {
  rows: UnshippedGroup[]; // 미출고가 있는 항목 중 표본이 충분한 것: 미출고율이 높은 순
  small: UnshippedGroup[]; // 미출고가 있지만 주문 줄이 MIN_LINES 미만이라 비율을 믿기 어려운 것(미출고 줄 순)
}

// key(l)로 항목을 나눠 미출고율을 낸다. 미출고가 한 번도 없는 항목은 뺀다(문제가 있는 곳만 본다).
export function groupUnshipped(lines: OrderLine[], key: (l: OrderLine) => string, minLines = MIN_LINES): UnshippedGroups {
  const groups = new Map<string, { lines: number; un: number; full: number; qty: Map<string, number> }>();
  for (const l of lines) {
    if (!isTarget(l)) continue;
    const k = key(l);
    const g = groups.get(k) ?? { lines: 0, un: 0, full: 0, qty: new Map() };
    g.lines += 1;
    if (isUnshipped(l)) {
      g.un += 1;
      if (isFullyUnshipped(l)) g.full += 1;
      g.qty.set(l.unit, (g.qty.get(l.unit) ?? 0) + l.unshipped);
    }
    groups.set(k, g);
  }
  const all: UnshippedGroup[] = [...groups]
    .filter(([, g]) => g.un > 0)
    .map(([label, g]) => ({ label, lines: g.lines, unshippedLines: g.un, fullLines: g.full, rate: g.un / g.lines, quantities: unitList(g.qty) }));
  const byLabel = (a: UnshippedGroup, b: UnshippedGroup) => a.label.localeCompare(b.label, 'ko');
  return {
    rows: all.filter((g) => g.lines >= minLines).sort((a, b) => b.rate - a.rate || b.unshippedLines - a.unshippedLines || byLabel(a, b)),
    small: all.filter((g) => g.lines < minLines).sort((a, b) => b.unshippedLines - a.unshippedLines || byLabel(a, b)),
  };
}

export const byProduct = (l: OrderLine) => l.product;
export const byCustomer = (l: OrderLine) => baseCustomerName(l.customer);
export const byTerminal = (l: OrderLine) => l.terminal || '미지정';

// 사유별 빈도(미출고 줄 기준). 자유 텍스트라 앞뒤 공백을 떼고 연속 공백을 하나로 합쳐 센다.
export function reasonCounts(lines: OrderLine[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!isUnshipped(l)) continue;
    const reason = (l.reason ?? '').trim().replace(/\s+/g, ' ') || NO_REASON;
    m.set(reason, (m.get(reason) ?? 0) + 1);
  }
  return [...m].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'ko'));
}
