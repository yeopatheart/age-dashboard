// 정산 매입내역의 행 만들기와 합계(순수 함수). 행은 "출고일 × 품목(상품명)"이고, 목록은 판매내역에서 읽을 때마다 계산한다:
// 판매내역에 어떤 날 어떤 품목이 올라오면 그 (출고일, 품목) 행이 자동으로 생긴다. 사용자가 입력해서 저장한 값(settlement_purchases)은
// 판매내역이 나중에 바뀌어도 사라지지 않는다 — 입력한 행은 지금 판매내역에 없어도 계속 보여 준다.
// 총 판매가와 수익은 저장하지 않고 여기서 계산한다. 설계는 docs/prd/settlement.md.
import type { SalesRow } from './sales';

// 사용자가 입력해서 저장한 값
export interface StoredPurchase {
  orderDate: string;
  productName: string;
  sellerId: string | null;
  supplierId: string | null;
  price: number | null;
  paid: boolean;
  memo: string | null;
}

export interface PurchaseRow {
  key: string; // 화면에서 행을 구분하는 값(출고일|품목)
  orderDate: string;
  product: string;
  sellerId: string | null;
  supplierId: string | null;
  price: number | null; // 매입가(원). null이면 아직 입력 전
  paid: boolean;
  memo: string;
  salesTotal: number; // 총 판매가: 같은 출고일·같은 품목의 판매내역 판매가 합계
  salesCount: number; // 그 판매내역 줄 수
  salesPriced: number; // 그중 판매가를 입력한 줄 수(salesCount보다 작으면 총 판매가가 덜 잡힌 것이다)
}

export const purchaseKey = (orderDate: string, product: string) => `${orderDate}|${product}`;

// 수익 = 총 판매가 − 매입가. 매입가를 입력하지 않았으면 수익을 알 수 없으므로 null(총 수익에서도 뺀다).
export const profitOf = (row: Pick<PurchaseRow, 'price' | 'salesTotal'>): number | null => (row.price === null ? null : row.salesTotal - row.price);

// 판매내역 줄과 저장된 입력값에서 매입내역 행을 만든다. 정렬은 출고일 → 품목명(가나다).
export function buildPurchaseRows(sales: SalesRow[], stored: StoredPurchase[]): PurchaseRow[] {
  const byKey = new Map<string, PurchaseRow>();
  const ensure = (orderDate: string, product: string): PurchaseRow => {
    const key = purchaseKey(orderDate, product);
    let row = byKey.get(key);
    if (!row) {
      row = { key, orderDate, product, sellerId: null, supplierId: null, price: null, paid: false, memo: '', salesTotal: 0, salesCount: 0, salesPriced: 0 };
      byKey.set(key, row);
    }
    return row;
  };
  for (const s of sales) {
    const row = ensure(s.orderDate, s.product);
    row.salesCount += 1;
    if (s.price !== null) {
      row.salesTotal += s.price;
      row.salesPriced += 1;
    }
  }
  for (const p of stored) {
    const row = ensure(p.orderDate, p.productName);
    row.sellerId = p.sellerId;
    row.supplierId = p.supplierId;
    row.price = p.price;
    row.paid = p.paid;
    row.memo = p.memo ?? '';
  }
  return [...byKey.values()].sort((a, b) => (a.orderDate === b.orderDate ? 0 : a.orderDate < b.orderDate ? -1 : 1) || a.product.localeCompare(b.product, 'ko'));
}

export interface PurchaseTotals {
  rows: number;
  purchaseTotal: number; // 총 매입가: 매입가를 입력한 행의 합
  salesTotal: number; // 총 판매가: 모든 행의 합
  profitTotal: number; // 총 수익: 매입가를 입력한 행의 (총 판매가 − 매입가) 합
  missingPrice: number; // 매입가 미입력 행 수
  partialSales: number; // 판매가를 다 입력하지 않아 총 판매가가 덜 잡힌 행 수
}

export function totalsOf(rows: PurchaseRow[]): PurchaseTotals {
  const t: PurchaseTotals = { rows: rows.length, purchaseTotal: 0, salesTotal: 0, profitTotal: 0, missingPrice: 0, partialSales: 0 };
  for (const r of rows) {
    t.salesTotal += r.salesTotal;
    if (r.salesPriced < r.salesCount) t.partialSales += 1;
    const profit = profitOf(r);
    if (profit === null) {
      t.missingPrice += 1;
      continue;
    }
    t.purchaseTotal += r.price ?? 0;
    t.profitTotal += profit;
  }
  return t;
}
