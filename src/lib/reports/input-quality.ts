// 주문 입력 품질(순수 함수). 카카오 붙여넣기로 들어온 주문 줄이 얼마나 깔끔하게 읽혔는지, 얼마나 바뀌는지를 본다.
//  - 확인 필요(needs_review): 분석 시점에 파서가 확신하지 못한 줄. 분석 때만 저장되고 이후 수정으로 지워지지 않아 "입력 시점의 품질"을 보는 안정된 지표다.
//  - AI 보정(ai_repaired): AI가 형식을 벗어난 줄을 재구성한 줄. 기록은 마이그레이션 0055 적용 이후 입력분부터 쌓인다.
//  - 주문 변경: change_status의 "현재 상태"(none=최초 주문, new=이후 추가, modified=수정, cancelled=취소). 변경 이력은 없다.
//  - 분모는 취소 줄을 포함한 전체 주문 줄이다(입력 시점의 품질을 보므로).
import type { Granularity } from '../report.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { bucketKeyOf, type Bucket } from './buckets.ts';
import { baseCustomerName } from './sales-report.ts';

export type ChangeStatus = 'new' | 'modified' | 'cancelled' | 'none';

export interface InputLine {
  orderDate: string;
  customer: string;
  terminal: string;
  product: string;
  needsReview: boolean;
  reviewReason: string | null;
  aiRepaired: boolean;
  changeStatus: ChangeStatus;
}

export interface Paste {
  orderDate: string;
  round: 1 | 2;
}

export const NO_REASON = '(사유 없음)';
export const MIN_LINES = 3; // 이보다 주문 줄이 적은 항목은 비율이 흔들려 "표본 부족"으로 접는다

const rate = (n: number, total: number): number | null => (total === 0 ? null : n / total);

export interface InputSummary {
  lines: number;
  review: number;
  reviewRate: number | null;
  ai: number;
  aiRate: number | null;
  pastes: number;
  changes: { none: number; new: number; modified: number; cancelled: number };
}

export function inputSummary(lines: InputLine[], pastes: Paste[]): InputSummary {
  const changes = { none: 0, new: 0, modified: 0, cancelled: 0 };
  let review = 0;
  let ai = 0;
  for (const l of lines) {
    changes[l.changeStatus] += 1;
    if (l.needsReview) review += 1;
    if (l.aiRepaired) ai += 1;
  }
  return { lines: lines.length, review, reviewRate: rate(review, lines.length), ai, aiRate: rate(ai, lines.length), pastes: pastes.length, changes };
}

export interface InputTrendPoint {
  bucket: Bucket;
  lines: number;
  review: number;
  ai: number;
  reviewRate: number | null; // 주문 줄이 없으면 null(선이 끊긴다)
  aiRate: number | null;
  pastes1: number; // 1차 붙여넣기 횟수
  pastes2: number;
}

export function inputTrend(lines: InputLine[], pastes: Paste[], buckets: Bucket[], granularity: Granularity): InputTrendPoint[] {
  const points = buckets.map((bucket) => ({ bucket, lines: 0, review: 0, ai: 0, pastes1: 0, pastes2: 0 }));
  const indexByKey = new Map(points.map((p, i) => [p.bucket.key, i]));
  for (const l of lines) {
    const i = indexByKey.get(bucketKeyOf(l.orderDate, granularity));
    if (i === undefined) continue;
    points[i].lines += 1;
    if (l.needsReview) points[i].review += 1;
    if (l.aiRepaired) points[i].ai += 1;
  }
  for (const p of pastes) {
    const i = indexByKey.get(bucketKeyOf(p.orderDate, granularity));
    if (i === undefined) continue;
    if (p.round === 2) points[i].pastes2 += 1;
    else points[i].pastes1 += 1;
  }
  return points.map((p) => ({ ...p, reviewRate: rate(p.review, p.lines), aiRate: rate(p.ai, p.lines) }));
}

// 확인 필요 사유별 줄 수. 파서가 정해진 문구로 쓰지만 앞뒤 공백을 떼고 연속 공백을 합쳐 센다.
export function reviewReasons(lines: InputLine[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!l.needsReview) continue;
    const reason = (l.reviewReason ?? '').trim().replace(/\s+/g, ' ') || NO_REASON;
    m.set(reason, (m.get(reason) ?? 0) + 1);
  }
  return [...m].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'ko'));
}

export interface ReviewGroup {
  label: string;
  lines: number;
  review: number;
  ai: number;
  rate: number; // 확인 필요율
}

export interface ReviewGroups {
  rows: ReviewGroup[]; // 확인 필요가 있는 항목 중 표본이 충분한 것: 확인 필요율이 높은 순
  small: ReviewGroup[]; // 확인 필요가 있지만 주문 줄이 MIN_LINES 미만인 것(확인 필요 줄 순)
}

// 항목을 나눠 확인 필요율을 낸다. 확인 필요가 한 번도 없는 항목은 뺀다(문제가 있는 곳만 본다).
export function groupReview(lines: InputLine[], key: (l: InputLine) => string, minLines = MIN_LINES): ReviewGroups {
  const groups = new Map<string, { lines: number; review: number; ai: number }>();
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k) ?? { lines: 0, review: 0, ai: 0 };
    g.lines += 1;
    if (l.needsReview) g.review += 1;
    if (l.aiRepaired) g.ai += 1;
    groups.set(k, g);
  }
  const all: ReviewGroup[] = [...groups].filter(([, g]) => g.review > 0).map(([label, g]) => ({ label, lines: g.lines, review: g.review, ai: g.ai, rate: g.review / g.lines }));
  const byLabel = (a: ReviewGroup, b: ReviewGroup) => a.label.localeCompare(b.label, 'ko');
  return {
    rows: all.filter((g) => g.lines >= minLines).sort((a, b) => b.rate - a.rate || b.review - a.review || byLabel(a, b)),
    small: all.filter((g) => g.lines < minLines).sort((a, b) => b.review - a.review || byLabel(a, b)),
  };
}

export const byProduct = (l: InputLine) => l.product;
export const byCustomer = (l: InputLine) => baseCustomerName(l.customer);
export const byTerminal = (l: InputLine) => l.terminal || '미지정';
