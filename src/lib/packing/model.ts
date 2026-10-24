// 박스 추천 모델 v1. 의존성 없는 순수 함수 — 앱(서버)과 백테스트 스크립트(scripts/packing-backtest.ts)가
// 같은 코드를 쓴다. 신경망이 아니라 박스 기록을 집계해서 만든 설명 가능한 규칙+사례 모델이다.
//
// 추천 구조:
//   1. 물봉 상품(보리새우 등)은 물봉 박스로 보내고, 박스 개수는 수량 용량으로 정한다.
//   2. 나머지 상품은 "비슷한 과거 1박스 주문"을 찾아(사례 기반) 박스 종류 후보를 순위로 낸다.
//   3. 나머지 상품이 박스 하나에 안 들어갈 만큼 많으면 용량 기준으로 나눠 담는다.
// 학습 데이터 신뢰도: 1박스 기록은 상품 배치까지 정확하므로 사례(kNN)와 용량 추정에 쓰고,
// 2박스 이상 기록은 박스 종류·개수만 믿고 물봉 개수·분할 파라미터 추정에만 쓴다.

export interface PackingItem {
  name: string;
  unit: string;
  quantity: number;
  // 주문에서 물봉(수조) 포장 대상으로 표시된 상품 (order_items.is_mulbong 또는 products.needs_mulbong)
  mulbongFlag: boolean;
}

export interface TrainingBox {
  boxName: string;
  isMulbongBox: boolean;
  items: PackingItem[];
}

export interface TrainingRecord {
  orderDate: string;
  businessName: string;
  boxes: TrainingBox[];
  // false = 사람이 상품 배치를 확인하지 않고 모델이 자동 배정한 기록(박스 종류·개수만 입력). 생략하면 확인된 것으로 본다.
  itemsVerified?: boolean;
}

interface PackingCase {
  items: { key: string; quantity: number }[];
  boxName: string;
  isMulbongBox: boolean;
}

export interface PackingModelParams {
  // 물봉 박스: kg 상품을 미 단위 부하로 환산하는 계수, 박스 하나의 용량(부하 단위)
  mulbongKgEq: number;
  mulbongCapacity: number;
  // 나머지 상품: 같은 환산 계수
  remainderKgEq: number;
  // 박스 용량 = 1박스 기록 부하 분포의 이 분위수 (과하게 나누지 않도록 데이터로 정한다)
  capacityPercentile: number;
  // 나머지 상품의 부하가 이 값 이하이고 물봉 박스가 1개면 물봉 박스에 같이 담는다(없으면 -1)
  mergeMaxLoad: number;
}

export interface PackingModel {
  version: string;
  trainedAt: string;
  recordCount: number;
  singleBoxCount: number;
  cases: PackingCase[];
  // 물봉 표시된 상품이 실제로 물봉 박스에 담긴 비율 (상품명 기준)
  mulbongStats: Record<string, { inBox: number; total: number }>;
  mulbongBoxName: string | null;
  params: PackingModelParams;
  // 물봉 외 박스 종류별 용량(부하 단위) — 1박스 기록의 부하 분포에서 추정
  boxCapacity: Record<string, number>;
  fallbackCapacity: number;
}

export interface RecommendedBox {
  boxName: string;
  isMulbongBox: boolean;
  // items = 입력 상품 배열의 인덱스와 담을 수량
  items: { index: number; quantity: number }[];
}

export interface RecommendedPlan {
  boxes: RecommendedBox[];
  score: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Recommendation {
  modelVersion: string;
  candidates: RecommendedPlan[];
  confidence: Confidence;
  confidenceScore: number;
}

const EPS = 1e-6;
const KNN_K = 8;
const KNN_POWER = 6;
const MAX_CANDIDATES = 3;
const HIGH_CONFIDENCE = 0.7;
const MEDIUM_CONFIDENCE = 0.45;

const itemKey = (i: { name: string; unit: string }) => `${i.name}|${i.unit}`;

function itemLoad(i: { unit: string; quantity: number }, kgEq: number): number {
  return i.unit === 'kg' ? i.quantity * kgEq : i.quantity;
}

function totalLoad(items: PackingItem[], kgEq: number): number {
  return items.reduce((s, i) => s + itemLoad(i, kgEq), 0);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// 후보 값들 중 손실이 최소인 값이 여러 개면 가운데 값을 고른다(경계값에 치우치지 않게).
function fitGrid(candidates: number[], loss: (v: number) => number): number {
  let best = Infinity;
  let winners: number[] = [];
  for (const v of candidates) {
    const l = loss(v);
    if (l < best - EPS) {
      best = l;
      winners = [v];
    } else if (Math.abs(l - best) <= EPS) {
      winners.push(v);
    }
  }
  return median(winners);
}

function isMulbongItem(stats: PackingModel['mulbongStats'], item: PackingItem): boolean {
  if (!item.mulbongFlag) return false;
  const s = stats[item.name];
  if (!s) return true;
  // 라플라스 보정: 기록이 적을 때는 표시를 그대로 믿는 쪽(0.5)으로 당긴다.
  return (s.inBox + 1) / (s.total + 2) >= 0.5;
}

function splitItems(items: PackingItem[], stats: PackingModel['mulbongStats']) {
  const mulbong: { item: PackingItem; index: number }[] = [];
  const rest: { item: PackingItem; index: number }[] = [];
  items.forEach((item, index) => (isMulbongItem(stats, item) ? mulbong : rest).push({ item, index }));
  return { mulbong, rest };
}

export function trainModel(records: TrainingRecord[], meta: { version: string; trainedAt: string }): PackingModel {
  const mulbongStats: PackingModel['mulbongStats'] = {};
  const mulbongBoxNames = new Map<string, number>();
  for (const r of records) {
    for (const b of r.boxes) {
      if (b.isMulbongBox) mulbongBoxNames.set(b.boxName, (mulbongBoxNames.get(b.boxName) ?? 0) + 1);
      // 자동 배정된 기록의 상품 배치는 모델 규칙의 결과일 뿐이라 통계에 넣지 않는다(자기 규칙을 다시 학습하는 순환 방지).
      if (r.itemsVerified === false) continue;
      for (const i of b.items) {
        if (!i.mulbongFlag) continue;
        const s = (mulbongStats[i.name] ??= { inBox: 0, total: 0 });
        s.total += 1;
        if (b.isMulbongBox) s.inBox += 1;
      }
    }
  }
  const mulbongBoxName = [...mulbongBoxNames.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const allItems = (r: TrainingRecord) => r.boxes.flatMap((b) => b.items);
  const split = (r: TrainingRecord) => splitItems(allItems(r), mulbongStats);

  // 물봉 박스 개수: 물봉 박스가 있는 기록에서 개수가 가장 많이 맞는 (환산 계수, 용량)
  const mulbongRecords = records.filter((r) => r.boxes.some((b) => b.isMulbongBox) && split(r).mulbong.length > 0);
  const mulbongCount = (r: TrainingRecord) => r.boxes.filter((b) => b.isMulbongBox).length;
  let mulbongKgEq = 1;
  let mulbongCapacity = 40;
  if (mulbongRecords.length > 0) {
    let bestLoss = Infinity;
    for (const kgEq of [0, 1, 2, 3]) {
      const capacity = fitGrid(
        Array.from({ length: 23 }, (_, i) => 10 + i * 5),
        (cap) => mulbongRecords.filter((r) => Math.max(1, Math.ceil(totalLoad(split(r).mulbong.map((x) => x.item), kgEq) / cap - EPS)) !== mulbongCount(r)).length,
      );
      const loss = mulbongRecords.filter((r) => Math.max(1, Math.ceil(totalLoad(split(r).mulbong.map((x) => x.item), kgEq) / capacity - EPS)) !== mulbongCount(r)).length;
      if (loss < bestLoss) {
        bestLoss = loss;
        mulbongKgEq = kgEq;
        mulbongCapacity = capacity;
      }
    }
  }

  // 1박스 기록 = 상품 배치까지 정확한 사례
  const single = records.filter((r) => r.boxes.length === 1);
  const cases: PackingCase[] = single.map((r) => ({
    items: r.boxes[0].items.map((i) => ({ key: itemKey(i), quantity: i.quantity })),
    boxName: r.boxes[0].boxName,
    isMulbongBox: r.boxes[0].isMulbongBox,
  }));

  const capacityFor = (kgEq: number, pct: number) => {
    const loadsByBox = new Map<string, number[]>();
    for (const r of single) {
      if (r.boxes[0].isMulbongBox) continue;
      const list = loadsByBox.get(r.boxes[0].boxName) ?? [];
      list.push(totalLoad(r.boxes[0].items, kgEq));
      loadsByBox.set(r.boxes[0].boxName, list);
    }
    const capacity: Record<string, number> = {};
    for (const [name, loads] of loadsByBox) {
      // 표본이 너무 적은 박스는 용량을 추정하지 않고 fallback을 쓴다.
      if (loads.length >= 5) capacity[name] = Math.max(1, percentile(loads.sort((a, b) => a - b), pct));
    }
    const values = Object.values(capacity);
    return { capacity, fallback: values.length ? Math.max(...values) : 20 };
  };

  // 나머지 상품의 kg 환산 계수: 물봉 외 박스 개수가 가장 많이 맞는 값
  const restRecords = records.filter((r) => r.boxes.some((b) => !b.isMulbongBox));
  const restCount = (r: TrainingRecord) => r.boxes.filter((b) => !b.isMulbongBox).length;
  const mainBoxName = (r: TrainingRecord) => {
    const counts = new Map<string, number>();
    for (const b of r.boxes) if (!b.isMulbongBox) counts.set(b.boxName, (counts.get(b.boxName) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  // (kg 환산 계수, 용량 분위수)를 함께 고른다 — 전체 기록의 박스 개수가 가장 많이 맞는 조합
  const restCountLoss = (kgEq: number, pct: number) => {
    const { capacity, fallback } = capacityFor(kgEq, pct);
    return restRecords.filter((r) => {
      const load = totalLoad(split(r).rest.map((x) => x.item), kgEq);
      const cap = capacity[mainBoxName(r)] ?? fallback;
      return Math.max(1, Math.ceil(load / cap - EPS)) !== restCount(r);
    }).length;
  };
  let remainderKgEq = 1;
  let capacityPercentile = 1;
  let bestRestLoss = Infinity;
  for (const pct of [0.8, 0.9, 0.95, 0.99]) {
    const kgEq = fitGrid([0.5, 1, 2, 3, 5], (k) => restCountLoss(k, pct));
    const loss = restCountLoss(kgEq, pct);
    if (loss < bestRestLoss) {
      bestRestLoss = loss;
      remainderKgEq = kgEq;
      capacityPercentile = pct;
    }
  }
  const { capacity: boxCapacity, fallback: fallbackCapacity } = capacityFor(remainderKgEq, capacityPercentile);

  // 물봉 상품과 나머지 상품이 같이 있을 때, 나머지가 별도 박스로 가는지 물봉 박스에 같이 담기는지
  const mixedRecords = records.filter((r) => {
    const s = split(r);
    return s.mulbong.length > 0 && s.rest.length > 0 && r.boxes.some((b) => b.isMulbongBox);
  });
  const mergeMaxLoad = fitGrid([-1, 0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20], (t) =>
    mixedRecords.filter((r) => {
      const merged = !r.boxes.some((b) => !b.isMulbongBox);
      return (totalLoad(split(r).rest.map((x) => x.item), remainderKgEq) <= t) !== merged;
    }).length,
  );

  return {
    version: meta.version,
    trainedAt: meta.trainedAt,
    recordCount: records.length,
    singleBoxCount: single.length,
    cases,
    mulbongStats,
    mulbongBoxName,
    params: { mulbongKgEq, mulbongCapacity, remainderKgEq, capacityPercentile, mergeMaxLoad },
    boxCapacity,
    fallbackCapacity,
  };
}

function similarity(query: Map<string, number>, c: PackingCase): number {
  const keys = new Set(c.items.map((i) => i.key));
  let inter = 0;
  const closeness: number[] = [];
  for (const i of c.items) {
    const q = query.get(i.key);
    if (q === undefined) continue;
    inter += 1;
    const hi = Math.max(q, i.quantity);
    if (hi > 0) closeness.push(Math.min(q, i.quantity) / hi);
  }
  const union = query.size + keys.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  const qty = closeness.length ? closeness.reduce((a, b) => a + b, 0) / closeness.length : 0;
  return jaccard + 0.3 * qty;
}

function rankBoxTypes(model: PackingModel, items: PackingItem[], excludeMulbongBox: boolean): { boxName: string; share: number }[] {
  const query = new Map<string, number>();
  for (const i of items) query.set(itemKey(i), (query.get(itemKey(i)) ?? 0) + i.quantity);
  const neighbors = model.cases
    .filter((c) => !(excludeMulbongBox && c.isMulbongBox))
    .map((c) => ({ boxName: c.boxName, sim: similarity(query, c) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, KNN_K);
  const votes = new Map<string, number>();
  for (const n of neighbors) votes.set(n.boxName, (votes.get(n.boxName) ?? 0) + Math.pow(n.sim, KNN_POWER));
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // 비슷한 사례가 전혀 없으면 사례가 가장 많은 박스를 같은 비중으로 제안한다.
    const counts = new Map<string, number>();
    for (const c of model.cases) if (!(excludeMulbongBox && c.isMulbongBox)) counts.set(c.boxName, (counts.get(c.boxName) ?? 0) + 1);
    const n = [...counts.values()].reduce((a, b) => a + b, 0);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([boxName, c]) => ({ boxName, share: n ? (c / n) * 0.5 : 0 }));
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([boxName, v]) => ({ boxName, share: v / total }));
}

// 상품을 용량 기준으로 균등하게 nBoxes개에 나눈다. 한 상품이 경계에 걸리면 수량을 쪼갠다.
function distribute(entries: { item: PackingItem; index: number }[], nBoxes: number, kgEq: number): { index: number; quantity: number }[][] {
  const boxes: { index: number; quantity: number }[][] = Array.from({ length: nBoxes }, () => []);
  if (nBoxes === 1) {
    boxes[0] = entries.map((e) => ({ index: e.index, quantity: e.item.quantity }));
    return boxes;
  }
  const target = entries.reduce((s, e) => s + itemLoad(e.item, kgEq), 0) / nBoxes;
  const sorted = [...entries].sort((a, b) => itemLoad(b.item, kgEq) - itemLoad(a.item, kgEq));
  let box = 0;
  let room = target;
  for (const e of sorted) {
    let remaining = e.item.quantity;
    const loadPerUnit = itemLoad(e.item, kgEq) / e.item.quantity;
    const step = e.item.unit === 'kg' ? 0.5 : 1;
    while (remaining > EPS) {
      let take = remaining;
      if (box < nBoxes - 1 && loadPerUnit * remaining > room + EPS) {
        take = Math.max(0, Math.floor((room / loadPerUnit) / step + EPS) * step);
      }
      if (take > EPS) {
        boxes[box].push({ index: e.index, quantity: Math.round(take * 100) / 100 });
        remaining = Math.round((remaining - take) * 100) / 100;
        room -= take * loadPerUnit;
      }
      if (remaining > EPS) {
        box += 1;
        room = target;
      }
    }
  }
  return boxes;
}

function buildPlan(model: PackingModel, items: PackingItem[], restBoxName: string | null, score: number): RecommendedPlan {
  const { mulbong, rest } = splitItems(items, model.mulbongStats);
  const { params } = model;
  const boxes: RecommendedBox[] = [];
  const mulbongName = model.mulbongBoxName ?? '물봉';

  const mulbongLoad = totalLoad(mulbong.map((x) => x.item), params.mulbongKgEq);
  const mulbongBoxes = mulbong.length ? Math.max(1, Math.ceil(mulbongLoad / params.mulbongCapacity - EPS)) : 0;
  const restLoad = totalLoad(rest.map((x) => x.item), params.remainderKgEq);
  const merge = mulbongBoxes === 1 && rest.length > 0 && restLoad <= params.mergeMaxLoad;

  if (mulbongBoxes > 0) {
    const placed = distribute(merge ? [...mulbong, ...rest] : mulbong, mulbongBoxes, params.mulbongKgEq);
    for (const p of placed) boxes.push({ boxName: mulbongName, isMulbongBox: true, items: p });
  }
  if (rest.length > 0 && !merge && restBoxName) {
    const cap = model.boxCapacity[restBoxName] ?? model.fallbackCapacity;
    const n = Math.max(1, Math.ceil(restLoad / cap - EPS));
    for (const p of distribute(rest, n, params.remainderKgEq)) boxes.push({ boxName: restBoxName, isMulbongBox: false, items: p });
  }
  // 쪼개 담다 보면 비는 박스가 생길 수 있어 뺀다.
  return { boxes: boxes.filter((b) => b.items.length > 0), score };
}

export function recommend(model: PackingModel, items: PackingItem[]): Recommendation {
  const empty = { modelVersion: model.version, candidates: [], confidence: 'low' as Confidence, confidenceScore: 0 };
  if (items.length === 0) return empty;

  const { mulbong, rest } = splitItems(items, model.mulbongStats);
  // 나머지 상품이 없으면(물봉 상품만) 규칙만으로 결정되므로 후보는 하나다.
  if (rest.length === 0) {
    return { modelVersion: model.version, candidates: [buildPlan(model, items, null, 1)], confidence: 'high', confidenceScore: 1 };
  }
  const restLoad = totalLoad(rest.map((x) => x.item), model.params.remainderKgEq);
  const merge = mulbong.length > 0 && restLoad <= model.params.mergeMaxLoad;
  if (merge) {
    return { modelVersion: model.version, candidates: [buildPlan(model, items, null, 1)], confidence: 'medium', confidenceScore: 0.6 };
  }

  const ranking = rankBoxTypes(model, rest.map((x) => x.item), mulbong.length > 0);
  if (ranking.length === 0) return empty;
  const candidates = ranking.slice(0, MAX_CANDIDATES).map((r) => buildPlan(model, items, r.boxName, r.share));
  const top = ranking[0].share;
  const confidence: Confidence = top >= HIGH_CONFIDENCE ? 'high' : top >= MEDIUM_CONFIDENCE ? 'medium' : 'low';
  return { modelVersion: model.version, candidates, confidence, confidenceScore: top };
}

// 사람이 정한 박스 구성(종류·개수)에 상품을 자동으로 나눠 담는다. 물봉 상품은 물봉 박스로, 나머지는 다른 박스로 균등하게.
// 한쪽 종류의 박스만 있으면 모든 상품을 그 박스들에 나눈다. 반환 순서는 입력 박스 순서와 같고, 빈 박스도 포함한다.
export function assignToBoxes(model: PackingModel, items: PackingItem[], boxes: { boxName: string; isMulbongBox: boolean }[]): RecommendedBox[] {
  const result: RecommendedBox[] = boxes.map((b) => ({ boxName: b.boxName, isMulbongBox: b.isMulbongBox, items: [] }));
  if (boxes.length === 0 || items.length === 0) return result;
  const { mulbong, rest } = splitItems(items, model.mulbongStats);
  const slots = (pick: (b: { isMulbongBox: boolean }) => boolean) => boxes.map((b, i) => ({ b, i })).filter((x) => pick(x.b)).map((x) => x.i);
  const fill = (entries: { item: PackingItem; index: number }[], slotIndexes: number[], kgEq: number) => {
    if (entries.length === 0 || slotIndexes.length === 0) return;
    distribute(entries, slotIndexes.length, kgEq).forEach((placed, k) => (result[slotIndexes[k]].items = placed));
  };
  const mulbongSlots = slots((b) => b.isMulbongBox);
  const otherSlots = slots((b) => !b.isMulbongBox);
  if (mulbongSlots.length > 0 && otherSlots.length > 0) {
    fill(mulbong, mulbongSlots, model.params.mulbongKgEq);
    fill(rest, otherSlots, model.params.remainderKgEq);
  } else {
    fill([...mulbong, ...rest], boxes.map((_, i) => i), model.params.remainderKgEq);
  }
  return result;
}
