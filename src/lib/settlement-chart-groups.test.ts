import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductGroups, buildSellerGroups, topGroups } from './settlement/chart-groups.ts';
import { totalsOf, type PurchaseRow } from './settlement/purchases.ts';
import type { SalesRow } from './settlement/sales.ts';

const sale = (product: string, price: number | null, sellerId: string | null = null, purchasePrice: number | null = null): SalesRow => ({
  itemId: `${product}-${price}-${sellerId}`, cardId: 'c', orderDate: '2026-11-07', customer: '엔야', terminal: '남부', secondaryWeightKg: null, product, quantity: 1, unit: '미', sellerId, price, unitPrice: null, unitPriceOwn: null, priceOwn: null, supplierOwn: null, purchaseUnitOwn: null, purchaseOwn: null, supplierId: null, purchaseUnitPrice: null, purchasePrice, original: { product, quantity: 1, unit: '미' }, edited: false, paid: false, memo: '',
});
const prow = (orderDate: string, product: string, salesTotal: number, price: number | null): PurchaseRow => ({
  key: `${orderDate}|${product}`, orderDate, product, price, paid: false, salesTotal, salesCount: 1, salesPriced: 1,
});

test('품목별은 출고일을 합치고 전체 합계와 같다', () => {
  const rows = [prow('2026-11-06', '광어', 100, 60), prow('2026-11-07', '광어', 200, 150), prow('2026-11-07', '도미', 50, null)];
  const g = buildProductGroups(rows);
  const gwang = g.find((x) => x.name === '광어')!;
  assert.deepEqual([gwang.sales, gwang.purchase, gwang.profit, gwang.rows], [300, 210, 90, 2]);
  const dome = g.find((x) => x.name === '도미')!;
  assert.deepEqual([dome.sales, dome.purchase, dome.profit, dome.missingPrice], [50, 0, 0, 1]);
  const t = totalsOf(rows);
  assert.equal(g.reduce((s, x) => s + x.sales, 0), t.salesTotal);
  assert.equal(g.reduce((s, x) => s + x.purchase, 0), t.purchaseTotal);
  assert.equal(g.reduce((s, x) => s + x.profit, 0), t.profitTotal);
});

test('사업자별은 판매가·매입가를 상품 줄의 사업자구분으로 합치고, 매입가 없는 줄을 센다', () => {
  const sellers = [{ id: 'a', name: '통영아재수산' }, { id: 'b', name: '바른수산' }];
  const sales = [sale('광어', 100, 'a', 60), sale('광어', 50, 'b', 80), sale('도미', 70, null), sale('도미', null, 'a')];
  const g = buildSellerGroups(sales, sellers);
  const by = Object.fromEntries(g.map((x) => [x.name, x]));
  assert.deepEqual([by['통영아재수산'].sales, by['통영아재수산'].purchase, by['통영아재수산'].profit, by['통영아재수산'].missingPrice], [100, 60, 40, 1]);
  assert.deepEqual([by['바른수산'].sales, by['바른수산'].purchase, by['바른수산'].profit], [50, 80, -30]);
  assert.deepEqual([by['미지정'].sales, by['미지정'].missingPrice], [70, 1]);
});

test('삭제된 사업자는 미지정으로 센다', () => {
  const g = buildSellerGroups([sale('광어', 10, 'gone')], [{ id: 'a', name: 'A' }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].name, '미지정');
});

test('상위 N개와 기타로 묶고, 0원 항목은 그래프에서 뺀다', () => {
  const groups = ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ key: n, name: n, sales: (i + 1) * 10, purchase: 0, profit: 0, missingPrice: 0, rows: 1 }));
  groups.push({ key: 'z', name: 'z', sales: 0, purchase: 0, profit: 0, missingPrice: 0, rows: 1 });
  const { shown, rest } = topGroups(groups, 'sales', 3);
  assert.deepEqual(shown.map((g) => g.name), ['e', 'd', 'c']);
  assert.equal(rest?.name, '기타 2개');
  assert.equal(rest?.sales, 30);
  assert.equal(topGroups(groups, 'sales', 10).rest, null);
});
