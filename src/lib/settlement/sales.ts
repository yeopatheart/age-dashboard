// 정산 판매내역의 줄 만들기(순수 함수). 줄은 "출고 완료된 카드"의 주문 줄에서 읽을 때마다 계산하고,
// 사용자가 입력한 값(사업자·판매가·입금·메모)만 settlement_sales에서 붙인다. 설계는 docs/prd/settlement.md.
import { isUndecidedQuantity, type ChangeStatus } from '@/lib/orders';
import type { Stage } from '@/lib/overview';

export interface SalesSourceCard {
  id: string;
  orderDate: string; // 출고일(주문일) YYYY-MM-DD
  name: string; // 고객명(같은 날 1·2차에 모두 주문이 있으면 차수가 붙어 있다)
  sortOrder: number;
  stage: Stage;
}

export interface SalesSourceItem {
  id: string;
  dailyBusinessId: string;
  productSequence: number;
  productName: string;
  quantity: number;
  unit: string;
  unshippedQuantity: number;
  changeStatus: ChangeStatus;
}

// 사용자가 입력해서 저장한 값(없으면 아직 입력 전)
export interface StoredSale {
  orderItemId: string;
  sellerId: string | null;
  price: number | null;
  paid: boolean;
  memo: string | null;
}

export interface SalesRow {
  itemId: string;
  orderDate: string;
  customer: string;
  product: string;
  quantity: number; // 출고 수량 = 주문 수량 − 미출고 수량
  unit: string;
  sellerId: string | null;
  price: number | null;
  paid: boolean;
  memo: string;
}

// 판매내역에 올라가는 줄: 출고 완료된 카드의 줄 중 취소·수량 미정·출고 수량 0인 줄을 뺀 것.
// 정렬은 출고일 → 카드 순서 → 상품 순서(주문 목록에서 보이는 순서와 같다).
export function buildSalesRows(cards: SalesSourceCard[], items: SalesSourceItem[], stored: StoredSale[]): SalesRow[] {
  const cardById = new Map(cards.filter((c) => c.stage === 'done').map((c) => [c.id, c]));
  const storedByItem = new Map(stored.map((s) => [s.orderItemId, s]));
  const rows: { row: SalesRow; sortOrder: number; sequence: number }[] = [];
  for (const item of items) {
    const card = cardById.get(item.dailyBusinessId);
    if (!card) continue;
    if (item.changeStatus === 'cancelled' || isUndecidedQuantity(item)) continue;
    const quantity = item.quantity - item.unshippedQuantity;
    if (quantity <= 0) continue;
    const s = storedByItem.get(item.id);
    rows.push({
      sortOrder: card.sortOrder,
      sequence: item.productSequence,
      row: {
        itemId: item.id,
        orderDate: card.orderDate,
        customer: card.name,
        product: item.productName,
        quantity,
        unit: item.unit,
        sellerId: s?.sellerId ?? null,
        price: s?.price ?? null,
        paid: s?.paid ?? false,
        memo: s?.memo ?? '',
      },
    });
  }
  rows.sort((a, b) => (a.row.orderDate === b.row.orderDate ? 0 : a.row.orderDate < b.row.orderDate ? -1 : 1) || a.sortOrder - b.sortOrder || a.sequence - b.sequence);
  return rows.map((r) => r.row);
}
