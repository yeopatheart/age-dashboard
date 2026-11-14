// 정산 매입의 집계(순수 함수). 매입은 상품 줄마다 정하고(줄에서 고친 값 또는 날짜별 품목 단가표), 여기서는 그 줄들을
// 리포트·그래프가 쓰는 "출고일 × 품목" 행과 매입처별 합계로 모은다. 총 판매가와 수익은 저장하지 않고 계산한다. 설계는 docs/prd/settlement.md.
import type { SalesRow } from './sales';

export interface PurchaseRow {
  key: string; // 행을 구분하는 값(출고일|품목)
  orderDate: string;
  product: string;
  price: number | null; // 매입가: 그 품목의 모든 줄에 매입가가 있을 때만 합계. 하나라도 비어 있으면 null(수익에서 뺀다)
  paid: boolean; // 그 품목의 매입처에 모두 지급했는지(매입처가 없는 줄이 있으면 false)
  salesTotal: number; // 총 판매가: 같은 출고일·같은 품목의 판매내역 판매가 합계
  salesCount: number; // 그 판매내역 줄 수
  salesPriced: number; // 그중 판매가가 있는 줄 수(salesCount보다 작으면 총 판매가가 덜 잡힌 것이다)
}

export const purchaseKey = (orderDate: string, product: string) => `${orderDate}|${product}`;
export const paymentKey = (orderDate: string, supplierId: string) => `${orderDate}|${supplierId}`;

// 수익 = 총 판매가 − 매입가. 매입가를 알 수 없으면 수익도 알 수 없으므로 null(총 수익에서도 뺀다).
export const profitOf = (row: Pick<PurchaseRow, 'price' | 'salesTotal'>): number | null => (row.price === null ? null : row.salesTotal - row.price);

// 판매내역 줄에서 "출고일 × 품목" 행을 만든다. 정렬은 출고일 → 품목명(가나다). paid는 지급 체크(`출고일|매입처` 키 집합)로 정한다.
export function buildPurchaseRows(sales: SalesRow[], paidKeys: ReadonlySet<string> = new Set()): PurchaseRow[] {
  const groups = new Map<string, SalesRow[]>();
  for (const s of sales) {
    const key = purchaseKey(s.orderDate, s.product);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rows: PurchaseRow[] = [];
  for (const [key, lines] of groups) {
    const priced = lines.filter((l) => l.price !== null);
    const allPurchased = lines.every((l) => l.purchasePrice !== null);
    const bought = lines.filter((l) => (l.purchasePrice ?? 0) > 0); // 지급 대상: 매입가가 0보다 큰 줄
    rows.push({
      key,
      orderDate: lines[0].orderDate,
      product: lines[0].product,
      price: allPurchased ? lines.reduce((sum, l) => sum + (l.purchasePrice ?? 0), 0) : null,
      paid: bought.length > 0 && bought.every((l) => l.supplierId !== null && paidKeys.has(paymentKey(l.orderDate, l.supplierId))),
      salesTotal: priced.reduce((sum, l) => sum + (l.price ?? 0), 0),
      salesCount: lines.length,
      salesPriced: priced.length,
    });
  }
  return rows.sort((a, b) => (a.orderDate === b.orderDate ? 0 : a.orderDate < b.orderDate ? -1 : 1) || a.product.localeCompare(b.product, 'ko'));
}

export interface PurchaseTotals {
  rows: number;
  purchaseTotal: number; // 총 매입가: 매입가가 있는 행의 합
  salesTotal: number; // 총 판매가: 모든 행의 합
  profitTotal: number; // 총 수익: 매입가가 있는 행의 (총 판매가 − 매입가) 합
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

// ── 매입처별 합계(정산 화면의 "매입내역") ─────────────────────────────────────

export interface SupplierProductLine {
  product: string;
  quantity: number; // 같은 품목 줄의 수량 합(단위가 섞여 있어도 숫자만 더한다 — 실중량 kg 기준)
  lines: number;
  purchase: number; // 매입가 합(비어 있는 줄은 0)
  sales: number; // 그 줄들의 판매가 합
  missing: number; // 매입가가 없는 줄 수
}

export interface SupplierGroup {
  supplierId: string | null; // null = 매입처 미지정
  products: SupplierProductLine[];
  purchase: number;
  sales: number;
  missing: number;
  paid: boolean;
}

// 매입가가 있거나 매입처가 있는 줄을 매입처 → 품목으로 모은다(매입처 이름 순서는 화면이 정한다). 매입 정보가 전혀 없는 줄은 "미지정"에 들어간다.
export function buildSupplierGroups(sales: SalesRow[], paidKeys: ReadonlySet<string> = new Set()): SupplierGroup[] {
  const bySupplier = new Map<string, SupplierGroup>();
  for (const s of sales) {
    const id = s.supplierId;
    const key = id ?? '';
    let g = bySupplier.get(key);
    if (!g) {
      g = { supplierId: id, products: [], purchase: 0, sales: 0, missing: 0, paid: id !== null && paidKeys.has(paymentKey(s.orderDate, id)) };
      bySupplier.set(key, g);
    }
    let p = g.products.find((x) => x.product === s.product);
    if (!p) {
      p = { product: s.product, quantity: 0, lines: 0, purchase: 0, sales: 0, missing: 0 };
      g.products.push(p);
    }
    p.quantity += s.quantity;
    p.lines += 1;
    p.sales += s.price ?? 0;
    g.sales += s.price ?? 0;
    if (s.purchasePrice === null) {
      p.missing += 1;
      g.missing += 1;
    } else {
      p.purchase += s.purchasePrice;
      g.purchase += s.purchasePrice;
    }
  }
  for (const g of bySupplier.values()) g.products.sort((a, b) => a.product.localeCompare(b.product, 'ko'));
  return [...bySupplier.values()];
}
