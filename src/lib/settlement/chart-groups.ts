// 정산 그래프의 품목별·사업자별 집계(순수 함수). 숫자의 정의는 전체 그래프·매입내역 요약 줄과 같다(purchases.ts의 totalsOf).
//  - 품목별: 기간 안의 모든 출고일을 품목 이름으로 합친다. 판매가·매입가·수익 모두 매입내역 행(출고일 × 품목) 기준이라 품목별 합계가 전체와 같다.
//  - 사업자별: 판매가는 판매내역의 "사업자 구분", 매입가는 매입내역의 "사업자 구분"으로 각각 합친다(둘은 따로 저장되고 서로 다를 수 있다).
//    수익은 사업자별 (판매가 − 매입가)이다. 매입가를 아직 안 넣은 품목은 매입가가 0으로 잡혀 수익이 크게 보일 수 있어 missingPrice로 알려 준다
//    (사업자별 수익의 합은 전체의 "총 수익"과 다를 수 있다 — 전체는 매입가를 입력한 품목만 센다).
import { totalsOf, type PurchaseRow } from './purchases.ts';
import type { SalesRow } from './sales.ts';

export interface GroupPoint {
  key: string;
  name: string;
  sales: number;
  purchase: number;
  profit: number;
  missingPrice: number; // 매입가 미입력 매입내역 행 수
  rows: number; // 매입내역 행 수
}

export type GroupSortKey = 'sales' | 'purchase' | 'profit';

export const NO_SELLER_NAME = '미지정';
export const REST_KEY = '__rest';

export function buildProductGroups(rows: PurchaseRow[]): GroupPoint[] {
  const byProduct = new Map<string, PurchaseRow[]>();
  for (const r of rows) byProduct.set(r.product, [...(byProduct.get(r.product) ?? []), r]);
  return [...byProduct.entries()].map(([product, rs]) => {
    const t = totalsOf(rs);
    return { key: product, name: product, sales: t.salesTotal, purchase: t.purchaseTotal, profit: t.profitTotal, missingPrice: t.missingPrice, rows: t.rows };
  });
}

export function buildSellerGroups(sales: SalesRow[], purchases: PurchaseRow[], sellers: { id: string; name: string }[]): GroupPoint[] {
  const nameById = new Map(sellers.map((s) => [s.id, s.name]));
  const byKey = new Map<string, GroupPoint>();
  const group = (sellerId: string | null): GroupPoint => {
    const name = (sellerId && nameById.get(sellerId)) || NO_SELLER_NAME; // 삭제된 사업자도 미지정으로 센다
    let g = byKey.get(name === NO_SELLER_NAME ? '' : sellerId!);
    if (!g) {
      g = { key: name === NO_SELLER_NAME ? '' : sellerId!, name, sales: 0, purchase: 0, profit: 0, missingPrice: 0, rows: 0 };
      byKey.set(g.key, g);
    }
    return g;
  };
  for (const s of sales) if (s.price !== null) group(s.sellerId).sales += s.price;
  for (const p of purchases) {
    const g = group(p.sellerId);
    g.rows += 1;
    if (p.price === null) g.missingPrice += 1;
    else g.purchase += p.price;
  }
  const out = [...byKey.values()];
  for (const g of out) g.profit = g.sales - g.purchase;
  return out;
}

const byName = (a: GroupPoint, b: GroupPoint) => a.name.localeCompare(b.name, 'ko');

// 선택한 값이 큰 순서로 정렬한다(같으면 이름순). 미지정은 값이 같을 때 맨 뒤.
export function sortGroups(groups: GroupPoint[], sortKey: GroupSortKey): GroupPoint[] {
  return [...groups].sort((a, b) => b[sortKey] - a[sortKey] || (a.name === NO_SELLER_NAME ? 1 : b.name === NO_SELLER_NAME ? -1 : 0) || byName(a, b));
}

// 막대로 그릴 상위 limit개와, 나머지를 한 줄로 합친 "기타 N개". 값이 전부 0인 항목은 그래프에서 뺀다(표에는 남는다).
export function topGroups(groups: GroupPoint[], sortKey: GroupSortKey, limit: number): { shown: GroupPoint[]; rest: GroupPoint | null } {
  const sorted = sortGroups(
    groups.filter((g) => g.sales !== 0 || g.purchase !== 0 || g.profit !== 0),
    sortKey,
  );
  if (sorted.length <= limit) return { shown: sorted, rest: null };
  const tail = sorted.slice(limit);
  const rest: GroupPoint = {
    key: REST_KEY,
    name: `기타 ${tail.length}개`,
    sales: tail.reduce((s, g) => s + g.sales, 0),
    purchase: tail.reduce((s, g) => s + g.purchase, 0),
    profit: tail.reduce((s, g) => s + g.profit, 0),
    missingPrice: tail.reduce((s, g) => s + g.missingPrice, 0),
    rows: tail.reduce((s, g) => s + g.rows, 0),
  };
  return { shown: sorted.slice(0, limit), rest };
}
