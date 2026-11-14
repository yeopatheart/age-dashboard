import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, csvCell } from './reports/csv.ts';
import { baseCustomerName, customerStats, marginOf, productStats, quantityText, terminalStats, unpricedLines, weightText } from './reports/sales-report.ts';
import type { PurchaseRow } from './settlement/purchases.ts';
import type { SalesRow } from './settlement/sales.ts';

const sale = (over: Partial<SalesRow>): SalesRow => ({
  itemId: 'i', cardId: 'c', orderDate: '2026-11-09', customer: '바다횟집', terminal: '대구', secondaryWeightKg: null, product: '활전갱이', quantity: 3, unit: '미',
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

test('부가중량과 판매 업체 수: 품목별·업체별에 부가중량 합(kg), 품목별에 판매한 업체 수(1·2차는 한 업체)', () => {
  const sales = [
    sale({ itemId: '1', customer: '엔야 1차', quantity: 3, secondaryWeightKg: 1.3 }),
    sale({ itemId: '2', customer: '엔야 2차', quantity: 3, secondaryWeightKg: 1.2 }),
    sale({ itemId: '3', customer: '해월일식', quantity: 2, secondaryWeightKg: null }),
  ];
  const p = productStats(sales, [])[0];
  assert.equal(p.weightKg, 2.5);
  assert.equal(p.customers, 2); // 엔야(1·2차), 해월일식
  const c = customerStats(sales);
  assert.equal(c.find((x) => x.customer === '엔야')!.weightKg, 2.5);
  assert.equal(c.find((x) => x.customer === '해월일식')!.weightKg, 0);
  assert.equal(weightText(2.5), '2.5kg');
  assert.equal(weightText(0), '-');
});

test('terminalStats: 터미널별 매출·줄·업체 수·일수·수량·부가중량, 매출 순', () => {
  const sales = [
    sale({ itemId: '1', terminal: '대구', customer: '바다횟집', price: 30000, secondaryWeightKg: 1 }),
    sale({ itemId: '2', terminal: '대구', customer: '해월일식 1차', orderDate: '2026-11-10', price: 20000 }),
    sale({ itemId: '3', terminal: '남부', customer: '엔야', price: 90000, quantity: 2, unit: '키로' }),
    sale({ itemId: '4', terminal: '', customer: '무터미널', price: null }),
  ];
  const stats = terminalStats(sales);
  assert.deepEqual(stats.map((s) => s.terminal), ['남부', '대구', '미지정']);
  const daegu = stats[1];
  assert.equal(daegu.sales, 50000);
  assert.equal(daegu.lines, 2);
  assert.equal(daegu.customers, 2);
  assert.equal(daegu.days, 2);
  assert.equal(daegu.weightKg, 1);
  assert.deepEqual(stats[0].quantities, [{ unit: '키로', qty: 2 }]);
  assert.equal(stats[2].unpricedLines, 1);
});
