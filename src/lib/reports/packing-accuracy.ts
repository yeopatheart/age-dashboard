// 박스 추천 정확도 집계(순수 함수). 한 건 = 추천이 있던 박스 할당 제출 기록 하나(packing_records, 마지막 제출 기준).
// 지표는 박스 할당 화면의 정확도와 같다:
//  - 1순위 일치 = recommended_rank === 1 (제출한 박스 종류 구성이 1순위 후보와 같다. 상품 배치는 보지 않는다)
//  - 후보 3 안 = recommended_rank !== null
//  - 그대로 수락 = accepted_as_is (1순위 후보의 박스별 상품 배치까지 완전히 같다)
import type { Granularity } from '../report.ts';
import { bucketKeyOf, type Bucket } from './buckets.ts';

export type Confidence = 'high' | 'medium' | 'low';

export interface AccuracyRecord {
  id: string;
  orderDate: string;
  businessName: string;
  terminalName: string | null;
  rank: number | null;
  asIs: boolean | null;
  confidence: Confidence;
  modelVersion: string;
  boxNames: string[]; // 제출한 박스 종류(박스마다 하나, 같은 종류가 여럿이면 반복)
  topPlanBoxNames: string[] | null; // 그때 1순위 후보의 박스 종류. 후보를 읽지 못하면 null
  lineCount: number; // 주문 상품 줄 수
  hasMulbongBox: boolean;
  productNames: string[]; // 제출한 상품(중복 없이)
}

// 추천과 실제가 어떻게 다른지(틀린 유형).
export type Outcome = 'accepted' | 'layout' | 'alt' | 'count' | 'type' | 'unknown';

export const OUTCOME_ORDER: Outcome[] = ['accepted', 'layout', 'alt', 'count', 'type', 'unknown'];
export const OUTCOME_LABEL: Record<Outcome, string> = {
  accepted: '그대로 수락',
  layout: '박스 구성은 같고 상품 배치만 다름',
  alt: '후보 2·3순위를 선택',
  count: '1순위와 박스 개수가 다름',
  type: '개수는 같고 박스 종류가 다름',
  unknown: '비교할 추천 후보를 읽지 못함',
};

export function classifyOutcome(r: Pick<AccuracyRecord, 'rank' | 'asIs' | 'boxNames' | 'topPlanBoxNames'>): Outcome {
  if (r.asIs) return 'accepted';
  if (r.rank === 1) return 'layout';
  if (r.rank === 2 || r.rank === 3) return 'alt';
  if (!r.topPlanBoxNames || r.topPlanBoxNames.length === 0) return 'unknown';
  return r.topPlanBoxNames.length !== r.boxNames.length ? 'count' : 'type';
}

export interface AccStat {
  total: number;
  top1: number;
  top3: number;
  asIs: number;
}

export const emptyStat = (): AccStat => ({ total: 0, top1: 0, top3: 0, asIs: 0 });

export function addToStat(stat: AccStat, rank: number | null, asIs: boolean | null): void {
  stat.total += 1;
  if (rank === 1) stat.top1 += 1;
  if (rank !== null) stat.top3 += 1;
  if (asIs === true) stat.asIs += 1;
}

export function statOf(records: Pick<AccuracyRecord, 'rank' | 'asIs'>[]): AccStat {
  const stat = emptyStat();
  for (const r of records) addToStat(stat, r.rank, r.asIs);
  return stat;
}

// 비율(0~1). 건수가 0이면 null.
export const rate = (n: number, total: number): number | null => (total === 0 ? null : n / total);

export function outcomeCounts(records: AccuracyRecord[]): Record<Outcome, number> {
  const out = Object.fromEntries(OUTCOME_ORDER.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const r of records) out[classifyOutcome(r)] += 1;
  return out;
}

export interface TrendPoint {
  bucket: Bucket;
  stat: AccStat;
  top1: number | null;
  top3: number | null;
  asIs: number | null;
}

// 버킷마다 정확도. 건수가 없는 버킷은 비율이 null이라 선이 끊긴다(0%로 그리지 않는다).
export function accuracyTrend(records: AccuracyRecord[], buckets: Bucket[], granularity: Granularity): TrendPoint[] {
  const points = buckets.map((bucket) => ({ bucket, stat: emptyStat() }));
  const indexByKey = new Map(points.map((p, i) => [p.bucket.key, i]));
  for (const r of records) {
    const i = indexByKey.get(bucketKeyOf(r.orderDate, granularity));
    if (i !== undefined) addToStat(points[i].stat, r.rank, r.asIs);
  }
  return points.map((p) => ({ ...p, top1: rate(p.stat.top1, p.stat.total), top3: rate(p.stat.top3, p.stat.total), asIs: rate(p.stat.asIs, p.stat.total) }));
}

// ─── 분해 축 ────────────────────────────────────────────────────────────────
export interface AxisRow {
  label: string;
  stat: AccStat;
}

export interface AxisResult {
  rows: AxisRow[]; // 표본이 충분한 항목: 1순위 일치율이 낮은 순(순서가 정해진 축은 그 순서)
  small: AxisRow[]; // 표본이 부족한 항목(건수 순)
}

export interface AxisDef {
  id: string;
  title: string;
  keys: (r: AccuracyRecord) => string[]; // 한 기록이 속하는 항목들(상품 축은 여러 개)
  fixedOrder?: string[]; // 있으면 이 순서로 보여 준다(신뢰도처럼 순서가 의미 있는 축)
  hint?: string;
}

export const MIN_SAMPLE = 3;

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음' };

const lineBand = (n: number) => (n <= 2 ? '1~2줄' : n <= 5 ? '3~5줄' : '6줄 이상');
const boxBand = (n: number) => (n <= 1 ? '1박스' : n === 2 ? '2박스' : '3박스 이상');

export const ACCURACY_AXES: AxisDef[] = [
  { id: 'confidence', title: '신뢰도별', keys: (r) => [CONFIDENCE_LABEL[r.confidence]], fixedOrder: ['높음', '보통', '낮음'], hint: '추천 신뢰도가 낮을수록 실제로 틀리는지 봅니다.' },
  { id: 'boxes', title: '박스 수별', keys: (r) => [boxBand(r.boxNames.length)], fixedOrder: ['1박스', '2박스', '3박스 이상'] },
  { id: 'lines', title: '주문 상품 줄 수별', keys: (r) => [lineBand(r.lineCount)], fixedOrder: ['1~2줄', '3~5줄', '6줄 이상'] },
  { id: 'mulbong', title: '물봉 박스 포함', keys: (r) => [r.hasMulbongBox ? '물봉 박스 있음' : '물봉 박스 없음'], fixedOrder: ['물봉 박스 있음', '물봉 박스 없음'] },
  { id: 'product', title: '상품별 (이 상품이 들어 있을 때)', keys: (r) => r.productNames, hint: '한 기록에 여러 상품이 있으면 상품마다 한 번씩 센다. 틀리는 원인이 되는 상품을 찾는 데 씁니다.' },
  { id: 'business', title: '업체별', keys: (r) => [r.businessName || '(이름 없음)'] },
  { id: 'terminal', title: '터미널별', keys: (r) => [r.terminalName || '미지정'] },
  { id: 'model', title: '모델 버전별', keys: (r) => [r.modelVersion || '(알 수 없음)'] },
];

export function buildAxis(records: AccuracyRecord[], def: AxisDef, minSample = MIN_SAMPLE): AxisResult {
  const byLabel = new Map<string, AccStat>();
  for (const r of records) {
    for (const label of new Set(def.keys(r))) {
      const stat = byLabel.get(label) ?? emptyStat();
      addToStat(stat, r.rank, r.asIs);
      byLabel.set(label, stat);
    }
  }
  const all: AxisRow[] = [...byLabel].map(([label, stat]) => ({ label, stat }));
  if (def.fixedOrder) {
    const order = def.fixedOrder;
    const rows = all.filter((a) => order.includes(a.label)).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    return { rows, small: [] }; // 순서가 정해진 축은 건수가 적어도 그대로 보여 준다(항목 수가 몇 개뿐이다)
  }
  const top1Rate = (a: AxisRow) => a.stat.top1 / a.stat.total;
  const rows = all.filter((a) => a.stat.total >= minSample).sort((a, b) => top1Rate(a) - top1Rate(b) || b.stat.total - a.stat.total || a.label.localeCompare(b.label, 'ko'));
  const small = all.filter((a) => a.stat.total < minSample).sort((a, b) => b.stat.total - a.stat.total || a.label.localeCompare(b.label, 'ko'));
  return { rows, small };
}

// ─── 제출 이력(0055)으로 보는 최초 제출 vs 최종 ────────────────────────────────
export interface SubmitEventLite {
  dailyBusinessId: string | null;
  submittedAt: string;
  recommendationId: string | null;
  rank: number | null;
  asIs: boolean | null;
}

export interface SubmissionHistory {
  cards: number; // 이력이 있는 주문 카드 수
  resubmittedCards: number; // 두 번 이상 제출한 카드
  first: AccStat; // 첫 제출 기준(추천이 있던 제출만)
  final: AccStat; // 마지막 제출 기준(같은 카드들)
}

export function submissionHistory(events: SubmitEventLite[]): SubmissionHistory {
  const byCard = new Map<string, SubmitEventLite[]>();
  for (const e of events) {
    if (!e.dailyBusinessId) continue;
    const list = byCard.get(e.dailyBusinessId) ?? [];
    list.push(e);
    byCard.set(e.dailyBusinessId, list);
  }
  const first = emptyStat();
  const final = emptyStat();
  let resubmittedCards = 0;
  for (const list of byCard.values()) {
    list.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
    if (list.length > 1) resubmittedCards += 1;
    const firstEvent = list[0];
    const lastEvent = list[list.length - 1];
    if (firstEvent.recommendationId) addToStat(first, firstEvent.rank, firstEvent.asIs);
    if (lastEvent.recommendationId) addToStat(final, lastEvent.rank, lastEvent.asIs);
  }
  return { cards: byCard.size, resubmittedCards, first, final };
}

// ─── 화면에 넘기는 요약 ──────────────────────────────────────────────────────
export interface AccuracySummary {
  stat: AccStat;
  outcomes: Record<Outcome, number>;
  trend: TrendPoint[];
  axes: { id: string; title: string; hint?: string; fixed: boolean; result: AxisResult }[];
}

export function summarizeAccuracy(records: AccuracyRecord[], buckets: Bucket[], granularity: Granularity, minSample = MIN_SAMPLE): AccuracySummary {
  return {
    stat: statOf(records),
    outcomes: outcomeCounts(records),
    trend: accuracyTrend(records, buckets, granularity),
    axes: ACCURACY_AXES.map((def) => ({ id: def.id, title: def.title, hint: def.hint, fixed: !!def.fixedOrder, result: buildAxis(records, def, minSample) })),
  };
}
