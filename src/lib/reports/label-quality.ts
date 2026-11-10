// 라벨·상차 품질(순수 함수). 라벨 출력 이벤트는 출력 한 번에 라벨마다 한 줄이라, 한 라벨에 출력 이벤트가 2개 이상이면 재출력이다.
// 스캔·되돌리기 이벤트도 라벨(박스) 단위로 남는다(합포장으로 묶인 박스는 각각 남는다). 재출력 사유(박스 종류 변경 등)는 저장되지 않아 횟수만 센다.
import type { Granularity } from '../report.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { bucketKeyOf, type Bucket } from './buckets.ts';
import { baseCustomerName } from './sales-report.ts';

export interface LabelRec {
  cardId: string;
  orderDate: string;
  customer: string;
  prints: number; // 출력 이벤트 수(재출력 포함)
  scans: number;
  undos: number;
}

export const MIN_LABELS = 3; // 이보다 라벨이 적은 업체는 비율이 흔들려 "표본 부족"으로 접는다

const rate = (n: number, total: number): number | null => (total === 0 ? null : n / total);
const printed = (l: LabelRec) => l.prints >= 1;
const reprinted = (l: LabelRec) => l.prints >= 2;

export interface LabelSummary {
  labels: number; // 출력한 라벨 수(출력 이벤트가 1개 이상)
  reprinted: number; // 2번 이상 출력된 라벨 수
  extraPrints: number; // 추가 출력 건수 = 출력 이벤트 합 − 출력한 라벨 수
  reprintRate: number | null;
  scans: number;
  undos: number;
  undoRate: number | null; // 되돌리기 ÷ 스캔
  cards: number; // 출력한 라벨이 있는 업체 카드 수
  cardsReprinted: number; // 그중 재출력이 있었던 카드 수
  cardReprintRate: number | null;
}

export function labelSummary(recs: LabelRec[]): LabelSummary {
  const out = recs.filter(printed);
  const reprint = out.filter(reprinted);
  const cards = new Set(out.map((l) => l.cardId));
  const reprintCards = new Set(reprint.map((l) => l.cardId));
  const scans = recs.reduce((s, l) => s + l.scans, 0);
  const undos = recs.reduce((s, l) => s + l.undos, 0);
  return {
    labels: out.length,
    reprinted: reprint.length,
    extraPrints: out.reduce((s, l) => s + l.prints, 0) - out.length,
    reprintRate: rate(reprint.length, out.length),
    scans,
    undos,
    undoRate: rate(undos, scans),
    cards: cards.size,
    cardsReprinted: reprintCards.size,
    cardReprintRate: rate(reprintCards.size, cards.size),
  };
}

export interface LabelTrendPoint {
  bucket: Bucket;
  labels: number;
  reprinted: number;
  scans: number;
  undos: number;
  reprintRate: number | null; // 출력한 라벨이 없으면 null(선이 끊긴다)
  undoRate: number | null;
}

export function labelTrend(recs: LabelRec[], buckets: Bucket[], granularity: Granularity): LabelTrendPoint[] {
  const points = buckets.map((bucket) => ({ bucket, labels: 0, reprinted: 0, scans: 0, undos: 0 }));
  const indexByKey = new Map(points.map((p, i) => [p.bucket.key, i]));
  for (const l of recs) {
    const i = indexByKey.get(bucketKeyOf(l.orderDate, granularity));
    if (i === undefined) continue;
    if (printed(l)) points[i].labels += 1;
    if (reprinted(l)) points[i].reprinted += 1;
    points[i].scans += l.scans;
    points[i].undos += l.undos;
  }
  return points.map((p) => ({ ...p, reprintRate: rate(p.reprinted, p.labels), undoRate: rate(p.undos, p.scans) }));
}

export interface LabelGroup {
  label: string;
  labels: number;
  reprinted: number;
  scans: number;
  undos: number;
  reprintRate: number | null;
}

export interface LabelGroups {
  rows: LabelGroup[]; // 재출력이나 되돌리기가 있는 업체 중 표본이 충분한 것: 재출력률이 높은 순
  small: LabelGroup[];
}

// 업체별(1·2차는 한 업체). 재출력도 되돌리기도 없는 업체는 뺀다(문제가 있는 곳만 본다).
export function groupLabels(recs: LabelRec[], minLabels = MIN_LABELS): LabelGroups {
  const groups = new Map<string, { labels: number; reprinted: number; scans: number; undos: number }>();
  for (const l of recs) {
    const k = baseCustomerName(l.customer);
    const g = groups.get(k) ?? { labels: 0, reprinted: 0, scans: 0, undos: 0 };
    if (printed(l)) g.labels += 1;
    if (reprinted(l)) g.reprinted += 1;
    g.scans += l.scans;
    g.undos += l.undos;
    groups.set(k, g);
  }
  const all: LabelGroup[] = [...groups]
    .filter(([, g]) => g.reprinted > 0 || g.undos > 0)
    .map(([label, g]) => ({ label, ...g, reprintRate: rate(g.reprinted, g.labels) }));
  const byLabel = (a: LabelGroup, b: LabelGroup) => a.label.localeCompare(b.label, 'ko');
  return {
    rows: all.filter((g) => g.labels >= minLabels).sort((a, b) => (b.reprintRate ?? 0) - (a.reprintRate ?? 0) || b.undos - a.undos || byLabel(a, b)),
    small: all.filter((g) => g.labels < minLabels).sort((a, b) => b.reprinted + b.undos - (a.reprinted + a.undos) || byLabel(a, b)),
  };
}
