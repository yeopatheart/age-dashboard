// 주문 입력(확정) 한 번을 되돌리는 규칙(순수 함수). DB 접근은 orders/actions.ts가 한다.
//
// 입력 한 번이 한 일을 InputEffects로 기록해 두고(order_input_batches), 되돌릴 때 그 뒤에 아무도 건드리지 않았는지 확인한다.
// - 이 입력이 새로 만든 상품 줄 → "취소" 상태로 바꾼다(지우지 않는다: 칠판에 취소로 보이고 작업자가 알아본다).
// - 이 입력이 수정한 줄 → 수정 전 값으로 돌린다. 이 입력이 취소한 줄 → 취소 전 상태로 돌린다. 이 입력이 바꾼 메모 → 이전 메모로 돌린다.
// - 그 뒤에 수량·단위·이름을 고쳤거나 포장 체크·미출고가 있는 줄이 하나라도 있으면 아무것도 바꾸지 않고 그 줄을 알린다(일부만 되돌리면 알아보기 어렵다).
// - 이미 되돌려진 줄(재시도)은 건너뛴다: 중간에 실패해도 다시 눌러 끝까지 할 수 있다.

export interface CreatedItemEffect {
  id: string;
  dailyBusinessId: string;
  productName: string;
  quantity: number;
  unit: string;
}

// 수정·취소 전의 값. 이 입력이 바꾸는 열만 담는다.
export interface ItemBefore {
  quantity: number;
  unit: string;
  secondary_weight_kg: number | null;
  size_request: string | null;
  size_spec: unknown;
  is_mulbong: boolean;
  has_aerator: boolean;
  mulbong_box_count: number | null;
  has_ice_pack: boolean;
  from_stock: boolean;
  change_status: string;
  needs_review: boolean;
  review_reason: string | null;
  unshipped_quantity: number;
}

export interface ChangedItemEffect {
  id: string;
  kind: 'modified' | 'cancelled';
  productName: string;
  before: ItemBefore;
  after: { quantity: number; unit: string }; // 수정한 값(취소는 수량·단위를 바꾸지 않아 before와 같다)
}

export interface MemoEffect {
  dailyBusinessId: string;
  before: string | null;
  after: string;
}

export interface InputEffects {
  version: 1;
  createdCardIds: string[];
  createdItems: CreatedItemEffect[];
  changedItems: ChangedItemEffect[];
  memos: MemoEffect[];
}

export const emptyEffects = (): InputEffects => ({ version: 1, createdCardIds: [], createdItems: [], changedItems: [], memos: [] });

export function hasEffects(e: InputEffects): boolean {
  return e.createdItems.length + e.changedItems.length + e.memos.length > 0;
}

// 저장된 JSON을 믿지 않고 모양을 확인한다. 모양이 틀리면 null(되돌릴 수 없음).
export function parseEffects(value: unknown): InputEffects | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.createdCardIds) || !Array.isArray(v.createdItems) || !Array.isArray(v.changedItems) || !Array.isArray(v.memos)) return null;
  return value as InputEffects;
}

export interface EffectsSummary {
  newItems: number;
  modifiedItems: number;
  cancelledItems: number;
  newCards: number;
}
export function summarizeEffects(e: InputEffects): EffectsSummary {
  return {
    newItems: e.createdItems.length,
    modifiedItems: e.changedItems.filter((c) => c.kind === 'modified').length,
    cancelledItems: e.changedItems.filter((c) => c.kind === 'cancelled').length,
    newCards: e.createdCardIds.length,
  };
}

// 지금 DB에 있는 줄의 상태(되돌릴 수 있는지 판단하는 데 쓰는 열만).
export interface CurrentItem {
  id: string;
  product_name_raw: string;
  quantity: number;
  unit: string;
  change_status: string;
  is_packed: boolean;
  unshipped_quantity: number;
}
export interface CurrentMemo {
  dailyBusinessId: string;
  memo: string | null;
}

export interface UndoPlan {
  conflicts: string[]; // 비어 있지 않으면 아무것도 바꾸지 않는다(사람이 읽는 문구)
  cancelItemIds: string[]; // 새로 만든 줄 → 취소 상태로
  restoreItems: { id: string; before: ItemBefore }[]; // 수정·취소했던 줄 → 이전 값으로
  restoreMemos: { dailyBusinessId: string; memo: string | null }[];
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function planUndo(effects: InputEffects, items: ReadonlyMap<string, CurrentItem>, memos: ReadonlyMap<string, CurrentMemo>): UndoPlan {
  const plan: UndoPlan = { conflicts: [], cancelItemIds: [], restoreItems: [], restoreMemos: [] };

  for (const created of effects.createdItems) {
    const cur = items.get(created.id);
    if (!cur) continue; // 이미 지워졌다
    if (cur.change_status === 'cancelled') continue; // 이미 취소됐다(되돌렸거나 따로 취소했다)
    if (cur.is_packed) {
      plan.conflicts.push(`${created.productName}: 이미 포장 체크가 되어 있습니다`);
    } else if (!same(cur.quantity, created.quantity) || cur.unit !== created.unit || cur.product_name_raw !== created.productName) {
      plan.conflicts.push(`${created.productName}: 입력 뒤에 수량·단위·이름이 수정됐습니다`);
    } else if (cur.unshipped_quantity > 0) {
      plan.conflicts.push(`${created.productName}: 미출고가 등록되어 있습니다`);
    } else {
      plan.cancelItemIds.push(created.id);
    }
  }

  for (const changed of effects.changedItems) {
    const cur = items.get(changed.id);
    if (!cur) continue; // 줄이 지워졌다
    if (changed.kind === 'cancelled') {
      if (cur.change_status !== 'cancelled') continue; // 이미 되살렸다
      plan.restoreItems.push({ id: changed.id, before: changed.before });
      continue;
    }
    // 수정: 이미 수정 전 값이면 되돌린 것이다.
    if (same(cur.quantity, changed.before.quantity) && cur.unit === changed.before.unit && cur.change_status === changed.before.change_status) continue;
    if (cur.is_packed) {
      plan.conflicts.push(`${changed.productName}: 이미 포장 체크가 되어 있습니다`);
    } else if (!same(cur.quantity, changed.after.quantity) || cur.unit !== changed.after.unit || cur.change_status === 'cancelled') {
      plan.conflicts.push(`${changed.productName}: 입력 뒤에 다시 수정되거나 취소됐습니다`);
    } else {
      plan.restoreItems.push({ id: changed.id, before: changed.before });
    }
  }

  // 메모는 그 뒤에 바뀌었으면 건드리지 않는다(막지는 않는다).
  for (const memo of effects.memos) {
    const cur = memos.get(memo.dailyBusinessId);
    if (cur && (cur.memo ?? '') === memo.after) plan.restoreMemos.push({ dailyBusinessId: memo.dailyBusinessId, memo: memo.before });
  }

  return plan;
}
