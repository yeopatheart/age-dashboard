// 제출한 박스 구성과 지금 주문을 비교해서 "상품 이름만 바뀐 것"인지 가린다(순수 함수).
// 이름을 잘못 적어서 고친 경우에는 박스를 다시 볼 필요가 없는데, 주문 지문(orderSignature)에 이름이 들어 있어 "박스 재확인" 경고가 떴다(2026-11-16 현장).
// 줄 수·각 줄의 단위·수량이 제출한 박스에 담긴 것과 모두 같고 이름만 다를 때만 이름만 바뀐 것으로 본다. 조금이라도 다르면 false라 경고는 그대로 뜬다.
export interface LiveItemForRename {
  id: string;
  unit: string;
  quantity: number; // 주문 − 미출고
}
export interface SubmittedBoxItem {
  orderItemId: string | null; // 주문 줄이 지워졌으면 null
  unit: string;
  quantity: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isRenameOnly(live: readonly LiveItemForRename[], submitted: readonly SubmittedBoxItem[]): boolean {
  if (live.length === 0 || submitted.length === 0) return false;
  // 한 줄이 여러 박스에 나뉘어 담겼을 수 있어 줄(order_item_id)별로 합친다.
  const byItem = new Map<string, { unit: string; quantity: number }>();
  for (const s of submitted) {
    if (s.orderItemId === null) return false;
    const prev = byItem.get(s.orderItemId);
    if (prev && prev.unit !== s.unit) return false;
    byItem.set(s.orderItemId, { unit: s.unit, quantity: (prev?.quantity ?? 0) + s.quantity });
  }
  if (byItem.size !== live.length) return false;
  for (const item of live) {
    const sub = byItem.get(item.id);
    if (!sub || sub.unit !== item.unit || round2(sub.quantity) !== round2(item.quantity)) return false;
  }
  return true;
}

// 제출한 뒤 주문이 바뀌었는지: 제출 때 저장한 지문이 지금과 다르더라도 이름만 바뀐 것이면 바뀐 것으로 보지 않는다.
// 박스 할당 화면의 "주문 변경" 칩과 대시보드 경고(findChangedAfterPackingIgnoringRenames)가 같은 기준을 쓰게 한다(2026-11-16).
export function orderChangedAfterSubmit(
  recordSignature: string | null,
  liveSignature: string,
  live: readonly LiveItemForRename[],
  submitted: readonly SubmittedBoxItem[],
): boolean {
  if (!recordSignature || recordSignature === liveSignature) return false;
  return !isRenameOnly(live, submitted);
}
