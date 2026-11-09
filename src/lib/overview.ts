// 대시보드(진행 현황)·주문 목록 카드가 같이 쓰는 단계 계산. 순수 함수라 서버·클라이언트 어디서나 쓴다.
//
// 현장 순서: 박스 할당 → 라벨 출력 → 포장 → 상차. 라벨 출력 전에는 포장을 시작하지 않는다.
// 고객 카드 하나의 단계는 "처음으로 안 끝난 단계"다. 박스 단위인 라벨·상차는 박스 수와 비교해서 고객 단계로 올린다.
// 단, 상차 스캔이 한 번이라도 있으면 포장 체크(상품 줄 체크)와 무관하게 상차 기준으로 본다: 현장에서는 박스를 싣는 것이 실제 출고이고,
// 포장 체크를 빠뜨렸다고 상차까지 끝난 업체가 "포장 중"에 머물면 출고 완료 업체만 올라오는 정산에서 빠진다(누락된 체크는 설명에 따로 보인다).
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
import { normalizeMergeGroups, type MergeGroups } from './box-merge.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { isCardComplete, isUndecidedQuantity, type OrderItem } from './orders.ts';

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

// 단계별 색. 대시보드와 모바일 주문 목록이 같이 쓴다. 이웃한 단계(포장 중↔상차 중, 포장 완료↔출고 완료)가 비슷해 보이지 않게
// 색상 계열을 모두 다르게 잡았다(회색·노랑·빨강·보라·파랑·초록, 2026-11-07 사용자 지정 순서). 출고 완료는 속을 채운 초록 배지라 나머지(연한 배경)와도 구분된다.
export const STAGE_COLOR: Record<Stage, { solid: string; tint: string; border: string; text: string }> = {
  boxing: { solid: '#64748b', tint: '#f1f5f9', border: '#cbd5e1', text: '#334155' }, // 회색
  labeling: { solid: '#f59e0b', tint: '#fffbeb', border: '#fcd34d', text: '#92400e' }, // 노랑
  packing: { solid: '#ef4444', tint: '#fef2f2', border: '#fca5a5', text: '#b91c1c' }, // 빨강
  packed: { solid: '#8b5cf6', tint: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9' }, // 보라
  loading: { solid: '#2563eb', tint: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' }, // 파랑
  done: { solid: '#16a34a', tint: '#16a34a', border: '#16a34a', text: '#ffffff' }, // 초록(속이 찬 배지)
};

export function stageOf(boxes: number | null, states: BoxState[], packed: boolean, parcel = false): Stage {
  if (parcel) return packed ? 'done' : 'packing';
  if (boxes == null || boxes <= 0) return 'boxing';
  if (states.some((s) => s === 'none')) return 'labeling';
  const loaded = states.filter((s) => s === 'loaded').length;
  if (loaded > 0) return loaded < states.length ? 'loading' : 'done';
  return packed ? 'packed' : 'packing';
}

// 단계 옆에 붙이는 한 줄 설명(예: 라벨 2/3장, 상품 3/4줄 포장)
export function stageDetail(stage: Stage, c: { parcel: boolean; boxStates: BoxState[]; itemsDone: number; itemsLive: number }): string {
  if (c.parcel) return stage === 'done' ? '택배 · 포장 완료' : `택배 · 포장 ${c.itemsDone}/${c.itemsLive}줄`;
  const n = c.boxStates.length;
  const printed = c.boxStates.filter((s) => s !== 'none').length;
  const loaded = c.boxStates.filter((s) => s === 'loaded').length;
  // 상차까지 갔는데 포장 체크가 빠진 줄이 있으면 알려 준다(상차 기준으로 단계를 정하므로 누락이 가려지지 않게).
  const unchecked = c.itemsDone < c.itemsLive ? ` · 포장 체크 ${c.itemsDone}/${c.itemsLive}줄` : '';
  switch (stage) {
    case 'boxing': return '박스 미정';
    case 'labeling': return `라벨 ${printed}/${n}장`;
    case 'packing': return `포장 ${c.itemsDone}/${c.itemsLive}줄`;
    case 'packed': return `상차 대기 · ${n}박스`;
    case 'loading': return `상차 ${loaded}/${n}박스${unchecked}`;
    case 'done': return `${n}박스 모두 상차${unchecked}`;
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

// 카드 하나의 단계 판정(박스 수·박스별 상태·포장 완료·단계). 대시보드 카드와 정산이 같은 기준을 쓰도록 한 곳에 둔다.
export function stageOfCard(c: Pick<OverviewCardInput, 'items' | 'submittedBoxes' | 'labels' | 'parcel'>): { boxes: number | null; boxStates: BoxState[]; packed: boolean; stage: Stage } {
  const boxes = c.submittedBoxes ?? (c.parcel ? 1 : null);
  const boxStates = c.parcel ? [] : boxStatesOf(boxes, c.labels);
  const packed = isCardComplete(c.items);
  return { boxes, boxStates, packed, stage: stageOf(boxes, boxStates, packed, c.parcel) };
}

export function buildOverviewCard(c: OverviewCardInput): OverviewCard {
  const live = c.items.filter((i) => i.changeStatus !== 'cancelled');
  const done = live.filter((i) => !isUndecidedQuantity(i) && (i.isPacked || i.quantity - i.unshippedQuantity <= 0));
  const { boxes, boxStates, packed, stage } = stageOfCard(c);
  return { ...c, mergeGroups: normalizeMergeGroups(c.mergeGroups, boxes ?? 99), hasOrder: live.length > 0, itemsLive: live.length, itemsDone: done.length, boxes, boxStates, packed, stage };
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
