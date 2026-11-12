// 박스 기록 화면에서 박스에 담을 대상이 아니라서 빠지는 상품과 그 이유. 조용히 빠지면 박스에 안 담긴 채 출고될 수 있어서
// 화면이 안내할 수 있게 이유를 따로 구한다. 취소한 상품은 주문에서 빠진 것이라 여기에 넣지 않는다.
export type ExcludedReason = 'undecided' | 'unshipped';

export interface ExcludedItem {
  name: string;
  reason: ExcludedReason;
}

export const EXCLUDED_REASON_LABEL: Record<ExcludedReason, string> = { undecided: '수량 미정', unshipped: '전량 미출고' };

// 박스에 담을 남은 수량(주문 수량 − 미출고 수량)이 0 이하면 빠진다. null이면 박스에 담을 상품이다.
// 수량을 비워 저장한 "수량 미정"(수량 0, 단위 없음)과, 주문 전량이 미출고인 상품을 구분한다.
export function excludedReason(quantity: number, unit: string, unshippedQuantity: number): ExcludedReason | null {
  if (quantity - unshippedQuantity > 0) return null;
  return quantity === 0 && unit === '' ? 'undecided' : 'unshipped';
}
