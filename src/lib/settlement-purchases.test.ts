import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPurchaseRows, buildSupplierGroups, paymentKey, profitOf, totalsOf } from './settlement/purchases.ts';
import type { SalesRow } from './settlement/sales.ts';

const sale = (orderDate: string, product: string, price: number | null, purchasePrice: number | null = null, supplierId: string | null = null, quantity = 1): SalesRow => ({
  itemId: `${orderDate}-${product}-${price}-${purchasePrice}-${supplierId}`,
  orderDate,
  cardId: 'c',
  customer: '엔야',
  terminal: '남부',
  secondaryWeightKg: null,
  product,
  quantity,
  unit: 'kg',
  sellerId: null,
  price,
  unitPrice: null,
  unitPriceOwn: null,
  priceOwn: null,
  supplierOwn: null,
  purchaseUnitOwn: null,
  purchaseOwn: null,
  supplierId,
  purchaseUnitPrice: null,
  purchasePrice,
  original: { product, quantity, unit: 'kg' },
  edited: false,
  paid: false,
  memo: '',
});

test('sales of the same date and product merge into one purchase row', () => {
  const rows = buildPurchaseRows([sale('2026-11-14', '광어', 1000), sale('2026-11-14', '광어', 2000), sale('2026-11-14', '전복', null)]);
  assert.equal(rows.length, 2);
  const flounder = rows.find((r) => r.product === '광어');
  assert.equal(flounder?.salesTotal, 3000);
  assert.equal(flounder?.salesCount, 2);
  assert.equal(flounder?.salesPriced, 2);
  assert.equal(rows.find((r) => r.product === '전복')?.salesPriced, 0);
});

test('purchase price is the sum of the lines only when every line has one; profit is unknown otherwise', () => {
  const rows = buildPurchaseRows([sale('2026-11-14', '광어', 3000, 1200), sale('2026-11-14', '광어', 1000, 800), sale('2026-11-14', '전복', 5000, 3000), sale('2026-11-14', '전복', 2000, null), sale('2026-11-14', '도미', 4000)]);
  const flounder = rows.find((r) => r.product === '광어')!;
  assert.equal(flounder.price, 2000);
  assert.equal(profitOf(flounder), 2000);
  assert.equal(rows.find((r) => r.product === '전복')!.price, null); // 한 줄이 비어 있으면 전체를 알 수 없다
  assert.equal(profitOf(rows.find((r) => r.product === '도미')!), null);
  const totals = totalsOf(rows);
  assert.equal(totals.profitTotal, 2000);
  assert.equal(totals.missingPrice, 2);
  assert.equal(totals.purchaseTotal, 2000);
  assert.equal(totals.salesTotal, 4000 + 7000 + 4000 + 0 + 0);
});

test('paid is true only when every purchased line belongs to a supplier that was paid that day', () => {
  const paid = new Set([paymentKey('2026-11-14', 's1')]);
  const rows = buildPurchaseRows([sale('2026-11-14', '광어', 100, 50, 's1'), sale('2026-11-14', '전복', 100, 50, 's2'), sale('2026-11-14', '도미', 100, 50, null), sale('2026-11-14', '숭어', 100, null, null)], paid);
  const by = Object.fromEntries(rows.map((r) => [r.product, r.paid]));
  assert.deepEqual(by, { 광어: true, 전복: false, 도미: false, 숭어: false });
});

test('rows are sorted by date then product name', () => {
  const rows = buildPurchaseRows([sale('2026-11-15', '가자미', 1), sale('2026-11-14', '전복', 1), sale('2026-11-14', '광어', 1)]);
  assert.deepEqual(rows.map((r) => `${r.orderDate} ${r.product}`), ['2026-11-14 광어', '2026-11-14 전복', '2026-11-15 가자미']);
});

test('supplier groups sum purchases per supplier and product, with a group for lines without a supplier', () => {
  const paid = new Set([paymentKey('2026-11-14', 's1')]);
  const groups = buildSupplierGroups(
    [sale('2026-11-14', '광어', 1000, 600, 's1', 2), sale('2026-11-14', '광어', 500, 300, 's1', 1), sale('2026-11-14', '전복', 900, 700, 's2'), sale('2026-11-14', '도미', 400, null, null)],
    paid,
  );
  const s1 = groups.find((g) => g.supplierId === 's1')!;
  assert.deepEqual([s1.purchase, s1.sales, s1.missing, s1.paid, s1.products.length], [900, 1500, 0, true, 1]);
  assert.deepEqual([s1.products[0].quantity, s1.products[0].lines], [3, 2]);
  const s2 = groups.find((g) => g.supplierId === 's2')!;
  assert.equal(s2.paid, false);
  const none = groups.find((g) => g.supplierId === null)!;
  assert.deepEqual([none.purchase, none.missing, none.paid], [0, 1, false]);
});
