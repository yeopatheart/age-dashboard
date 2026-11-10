import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, csvCell } from './reports/csv.ts';
import { baseCustomerName, customerStats, marginOf, productStats, quantityText, unpricedLines } from './reports/sales-report.ts';
import type { PurchaseRow } from './settlement/purchases.ts';
import type { SalesRow } from './settlement/sales.ts';

const sale = (over: Partial<SalesRow>): SalesRow => ({
  itemId: 'i', orderDate: '2026-11-09', customer: '바다횟집', product: '활전갱이', quantity: 3, unit: '미',
  original: { product: '활전갱이', quantity: 3, unit: '미' }, edited: false, sellerId: null, price: 30000, unitPrice: null, paid: false, memo: '', ...over,
});
const purchase = (over: Partial<PurchaseRow>): PurchaseRow => ({
  key: 'k', orderDate: '2026-11-09', product: '활전갱이', sellerId: null, supplierId: null, price: 20000, paid: false, memo: '', salesTotal: 30000, salesCount: 1, salesPriced: 1, ...over,
});

test('csvCell: 따옴표 이스케이프, 숫자는 그대로, 수식 시작 글자는 막는다', () => {
  assert.equal(csvCell('바다,횟집'), '"바다,횟집"');
  assert.equal(csvCell('한 "줄"'), '"한 ""줄"""');
  assert.equal(csvCell(1234), '1234');
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('+82'), '"\'+82"');
  assert.equal(buildCsv(['a', 'b'], [['x', 1]]), '"a","b"\n"x",1');
});

test('baseCustomerName: 1·2차 표기만 뗀다', () => {
  assert.equal(baseCustomerName('엔야 2차'), '엔야');
  assert.equal(baseCustomerName('엔야 1차'), '엔야');
  assert.equal(baseCustomerName('엔야'), '엔야');
  assert.equal(baseCustomerName('스시 3차'), '스시 3차');
});

test('productStats: 매출·매입·이익·이익률, 수량은 단위별, 매입가가 비면 이익에서 뺀다', () => {
  const sales = [
    sale({ itemId: '1', quantity: 3, unit: '미', price: 30000 }),
    sale({ itemId: '2', customer: '해월일식', quantity: 2, unit: '미', price: 20000 }),
    sale({ itemId: '3', customer: '해월일식', quantity: 1.5, unit: '키로', price: null }), // 판매가 미입력
    sale({ itemId: '4', product: '생굴', quantity: 1, unit: '키로', price: 16000 }),
  ];
  const purchases = [
    purchase({ product: '활전갱이', price: 35000, salesTotal: 50000, salesCount: 3, salesPriced: 2 }), // 이익 15000
    purchase({ product: '생굴', price: null, salesTotal: 16000, salesCount: 1, salesPriced: 1 }), // 매입가 미입력
  ];
  const stats = productStats(sales, purchases);
  const a = stats.find((s) => s.product === '활전갱이')!;
  assert.equal(a.sales, 50000);
  assert.equal(a.purchase, 35000);
  assert.equal(a.profit, 15000);
  assert.equal(a.profitBase, 50000);
  assert.equal(a.margin, 0.3);
  assert.equal(a.lines, 3);
  assert.equal(a.unpricedLines, 1);
  assert.deepEqual(a.quantities, [{ unit: '미', qty: 5 }, { unit: '키로', qty: 1.5 }]);
  const b = stats.find((s) => s.product === '생굴')!;
  assert.equal(b.sales, 16000);
  assert.equal(b.profit, 0);
  assert.equal(b.margin, null);
  assert.equal(b.missingPurchase, 1);
  assert.deepEqual(stats.map((s) => s.product), ['활전갱이', '생굴']); // 매출 순
});

test('productStats: 판매내역에는 없고 매입만 입력된 품목도 매입·이익에 센다(정산 요약과 같게)', () => {
  const stats = productStats([], [purchase({ product: '남은품목', price: 5000, salesTotal: 0, salesCount: 0, salesPriced: 0 })]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].purchase, 5000);
  assert.equal(stats[0].profit, -5000);
});

test('marginOf: 매입가를 입력한 행의 판매가로만 이익률을 낸다', () => {
  const m = marginOf([purchase({ price: 20000, salesTotal: 30000 }), purchase({ product: 'x', price: null, salesTotal: 100000 })]);
  assert.deepEqual(m, { profit: 10000, base: 30000, margin: 10000 / 30000 });
  assert.equal(marginOf([purchase({ price: null })]).margin, null);
});

test('customerStats: 차수를 합쳐 업체별 매출·줄 수·일수·일평균·수량', () => {
  const sales = [
    sale({ customer: '엔야 1차', orderDate: '2026-11-09', price: 30000 }),
    sale({ customer: '엔야 2차', orderDate: '2026-11-09', price: 10000, quantity: 1 }),
    sale({ customer: '엔야', orderDate: '2026-11-10', price: 20000 }),
    sale({ customer: '바다횟집', price: null, unit: '키로', quantity: 2 }),
  ];
  const stats = customerStats(sales);
  assert.deepEqual(stats.map((s) => s.customer), ['엔야', '바다횟집']);
  const enya = stats[0];
  assert.equal(enya.sales, 60000);
  assert.equal(enya.lines, 3);
  assert.equal(enya.days, 2);
  assert.equal(enya.dailyAvg, 30000);
  assert.deepEqual(enya.quantities, [{ unit: '미', qty: 7 }]);
  assert.equal(stats[1].unpricedLines, 1);
  assert.equal(unpricedLines(sales), 1);
});

test('quantityText', () => {
  assert.equal(quantityText([{ unit: '미', qty: 3 }, { unit: '키로', qty: 5.4 }]), '3미 · 5.4키로');
  assert.equal(quantityText([]), '-');
});
