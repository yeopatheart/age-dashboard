// 대시보드(진행 현황)·주문 목록 카드가 같이 쓰는 단계 계산. 순수 함수라 서버·클라이언트 어디서나 쓴다.
//
// 현장 순서: 박스 할당 → 라벨 출력 → 포장 → 상차. 라벨 출력 전에는 포장을 시작하지 않는다.
// 고객 카드 하나의 단계는 "처음으로 안 끝난 단계"다. 박스 단위인 라벨·상차는 박스 수와 비교해서 고객 단계로 올린다.
//  - 박스 할당 중: 박스 할당에서 아직 제출하지 않았다(박스 수를 모른다)
//  - 라벨 출력 중: 박스 수만큼 라벨이 아직 안 나왔다
//  - 포장 중: 라벨은 다 나왔고 상품 포장 체크가 안 끝났다
//  - 포장 완료: 포장이 끝났고 상차 스캔이 아직 없다(상차 대기)
//  - 상차 중: 박스 일부만 상차 스캔됐다
//  - 출고 완료: 박스를 전부 상차 스캔했다
// 택배 터미널은 택배사 송장을 붙이므로 박스를 화면에서 정하지 않고(제출 전에도 1박스) 라벨 출력·상차 스캔도 하지 않는다.
// 그래서 박스 할당·라벨 출력 단계를 건너뛰고, 포장이 끝나면 더 진행할 단계가 없어 "출고 완료"로 본다(택배사 인계는 이 시스템에서 따로 관리하지 않는다).
// 택배 외 별도 주문(직배송 등)은 기본 주문과 똑같이 박스 할당 → 라벨 출력 → 상차를 거친다.
// 라벨 행(box_labels)은 라벨을 출력할 때 만들어지므로 행이 있으면 출력된 박스다.
import { normalizeMergeGroups, type MergeGroups } from '@/lib/box-merge';
import { isCardComplete, isUndecidedQuantity, type OrderItem } from '@/lib/orders';

export type BoxState = 'none' | 'printed' | 'loaded';
export interface LabelRow {
  seq: number;
  loaded: boolean;
}

// 박스 번호 1..boxes 마다 라벨 상태(미출력·출력·상차)를 만든다. 박스 수를 줄여 남은 번호의 라벨은 세지 않는다.
export function boxStatesOf(boxes: number | null, labels: LabelRow[]): BoxState[] {
  if (boxes == null || boxes <= 0) return [];
  const bySeq = new Map(labels.map((l) => [l.seq, l]));
  return Array.from({ length: Math.min(boxes, 99) }, (_, i) => {
    const label = bySeq.get(i + 1);
    return !label ? 'none' : label.loaded ? 'loaded' : 'printed';
  });
}

export type Stage = 'boxing' | 'labeling' | 'packing' | 'packed' | 'loading' | 'done';
export const STAGES: Stage[] = ['boxing', 'labeling', 'packing', 'packed', 'loading', 'done'];
export const STAGE_LABEL: Record<Stage, string> = {
  boxing: '박스 할당 중',
  labeling: '라벨 출력 중',
  packing: '포장 중',
  packed: '포장 완료',
  loading: '상차 중',
  done: '출고 완료',
};

export function stageOf(boxes: number | null, states: BoxState[], packed: boolean, parcel = false): Stage {
  if (parcel) return packed ? 'done' : 'packing';
  if (boxes == null || boxes <= 0) return 'boxing';
  if (states.some((s) => s === 'none')) return 'labeling';
  if (!packed) return 'packing';
  const loaded = states.filter((s) => s === 'loaded').length;
  if (loaded === 0) return 'packed';
  return loaded < states.length ? 'loading' : 'done';
}

// 단계 옆에 붙이는 한 줄 설명(예: 라벨 2/3장, 상품 3/4줄 포장)
export function stageDetail(stage: Stage, c: { parcel: boolean; boxStates: BoxState[]; itemsDone: number; itemsLive: number }): string {
  if (c.parcel) return stage === 'done' ? '택배 · 포장 완료' : `택배 · 포장 ${c.itemsDone}/${c.itemsLive}줄`;
  const n = c.boxStates.length;
  const printed = c.boxStates.filter((s) => s !== 'none').length;
  const loaded = c.boxStates.filter((s) => s === 'loaded').length;
  switch (stage) {
    case 'boxing': return '박스 미정';
    case 'labeling': return `라벨 ${printed}/${n}장`;
    case 'packing': return `포장 ${c.itemsDone}/${c.itemsLive}줄`;
    case 'packed': return `상차 대기 · ${n}박스`;
    case 'loading': return `상차 ${loaded}/${n}박스`;
    case 'done': return `${n}박스 모두 상차`;
  }
}

export interface OverviewCardInput {
  id: string;
  number: number;
  name: string;
  terminal: string;
  separate: boolean; // 별도 주문 터미널
  parcel: boolean; // 택배 터미널(별도 주문의 한 종류)
  roundLabel: string | null;
  items: Pick<OrderItem, 'changeStatus' | 'isPacked' | 'quantity' | 'unit' | 'unshippedQuantity'>[];
  submittedBoxes: number | null; // 박스 할당에서 제출한 박스 수(제출 전이면 null)
  labels: LabelRow[];
  mergeGroups: MergeGroups; // 합포장 묶음
  packingChanged: boolean; // 박스 구성을 정한 뒤 주문이 바뀌어 박스를 다시 확인해야 한다(경고 표시만 한다)
}

export interface OverviewCard extends OverviewCardInput {
  hasOrder: boolean; // 취소되지 않은 상품이 하나라도 있다
  itemsLive: number;
  itemsDone: number;
  boxes: number | null;
  boxStates: BoxState[];
  packed: boolean;
  stage: Stage;
}

export function buildOverviewCard(c: OverviewCardInput): OverviewCard {
  const live = c.items.filter((i) => i.changeStatus !== 'cancelled');
  const done = live.filter((i) => !isUndecidedQuantity(i) && (i.isPacked || i.quantity - i.unshippedQuantity <= 0));
  const boxes = c.submittedBoxes ?? (c.parcel ? 1 : null);
  const boxStates = c.parcel ? [] : boxStatesOf(boxes, c.labels);
  const packed = isCardComplete(c.items);
  return { ...c, mergeGroups: normalizeMergeGroups(c.mergeGroups, boxes ?? 99), hasOrder: live.length > 0, itemsLive: live.length, itemsDone: done.length, boxes, boxStates, packed, stage: stageOf(boxes, boxStates, packed, c.parcel) };
}

export interface StageTotals {
  customers: number; // 주문이 있는 고객 카드 수
  byStage: Record<Stage, number>;
  boxes: number; // 박스 수를 아는 카드들의 박스 합
  boxesPrinted: number;
  boxesLoaded: number;
}

export function totalsOf(cards: OverviewCard[]): StageTotals {
  const t: StageTotals = { customers: 0, byStage: { boxing: 0, labeling: 0, packing: 0, packed: 0, loading: 0, done: 0 }, boxes: 0, boxesPrinted: 0, boxesLoaded: 0 };
  for (const c of cards) {
    if (!c.hasOrder) continue;
    t.customers += 1;
    t.byStage[c.stage] += 1;
    t.boxes += c.boxStates.length;
    t.boxesPrinted += c.boxStates.filter((s) => s !== 'none').length;
    t.boxesLoaded += c.boxStates.filter((s) => s === 'loaded').length;
  }
  return t;
}
