import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPurchaseRows, profitOf, totalsOf } from './settlement/purchases.ts';

const sale = (orderDate: string, product: string, price: number | null) => ({
  itemId: `${orderDate}-${product}-${price}`,
  orderDate,
  customer: '엔야',
  product,
  quantity: 1,
  unit: '미',
  sellerId: null,
  price,
  unitPrice: null,
  paid: false,
  memo: '',
});

test('sales of the same date and product merge into one purchase row', () => {
  const rows = buildPurchaseRows([sale('2026-11-14', '광어', 1000), sale('2026-11-14', '광어', 2000), sale('2026-11-14', '전복', null)], []);
  assert.equal(rows.length, 2);
  const flounder = rows.find((r) => r.product === '광어');
  assert.equal(flounder?.salesTotal, 3000);
  assert.equal(flounder?.salesCount, 2);
  assert.equal(flounder?.salesPriced, 2);
  const abalone = rows.find((r) => r.product === '전복');
  assert.equal(abalone?.salesPriced, 0);
});

test('profit is unknown until the purchase price is entered, and totals skip those rows', () => {
  const rows = buildPurchaseRows(
    [sale('2026-11-14', '광어', 3000), sale('2026-11-14', '전복', 5000)],
    [{ orderDate: '2026-11-14', productName: '광어', sellerId: null, supplierId: null, price: 2000, paid: true, memo: null }],
  );
  const flounder = rows.find((r) => r.product === '광어')!;
  const abalone = rows.find((r) => r.product === '전복')!;
  assert.equal(profitOf(flounder), 1000);
  assert.equal(profitOf(abalone), null);
  const totals = totalsOf(rows);
  assert.equal(totals.profitTotal, 1000);
  assert.equal(totals.missingPrice, 1);
  assert.equal(totals.salesTotal, 8000);
  assert.equal(totals.purchaseTotal, 2000);
});

test('rows are sorted by date then product name', () => {
  const rows = buildPurchaseRows([sale('2026-11-15', '가자미', 1), sale('2026-11-14', '전복', 1), sale('2026-11-14', '광어', 1)], []);
  assert.deepEqual(rows.map((r) => `${r.orderDate} ${r.product}`), ['2026-11-14 광어', '2026-11-14 전복', '2026-11-15 가자미']);
});
