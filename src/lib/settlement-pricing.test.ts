import test from 'node:test';
import assert from 'node:assert/strict';
import { amountOf, isAutoAmount, priceKey, resolveLine, type LineOwn } from './settlement/pricing.ts';

const none: LineOwn = { unitPriceOwn: null, priceOwn: null, supplierOwn: null, purchaseUnitOwn: null, purchaseOwn: null };
const entry = { saleUnitPrice: 28000, supplierId: 's1', purchaseUnitPrice: 20000 };

test('resolveLine: 줄에 값이 없으면 단가표를 따르고 총액은 단가 × 수량이다', () => {
  assert.deepEqual(resolveLine(none, 1.1, entry), { unitPrice: 28000, price: 30800, supplierId: 's1', purchaseUnitPrice: 20000, purchasePrice: 22000 });
});

test('resolveLine: 단가표가 없으면 비어 있다', () => {
  assert.deepEqual(resolveLine(none, 2, undefined), { unitPrice: null, price: null, supplierId: null, purchaseUnitPrice: null, purchasePrice: null });
});

test('resolveLine: 줄에서 고친 값이 단가표보다 우선하고, 보정한 총액은 단가 × 수량을 덮어쓴다', () => {
  const own: LineOwn = { unitPriceOwn: 30000, priceOwn: 31000, supplierOwn: 's2', purchaseUnitOwn: 21000, purchaseOwn: null };
  assert.deepEqual(resolveLine(own, 1, entry), { unitPrice: 30000, price: 31000, supplierId: 's2', purchaseUnitPrice: 21000, purchasePrice: 21000 });
});

test('resolveLine: 같은 품목이어도 줄마다 매입처·매입단가가 다를 수 있다', () => {
  const a = resolveLine({ ...none, supplierOwn: 's2', purchaseUnitOwn: 18000 }, 1, entry);
  const b = resolveLine(none, 1, entry);
  assert.deepEqual([a.supplierId, a.purchasePrice, b.supplierId, b.purchasePrice], ['s2', 18000, 's1', 20000]);
});

test('amountOf·isAutoAmount: 원 단위 반올림, 단가 × 수량 그대로인 총액만 자동으로 본다', () => {
  assert.equal(amountOf(28000, 1.1), 30800);
  assert.equal(amountOf(1000, 0.333), 333);
  assert.equal(isAutoAmount(30800, 28000, 1.1), true);
  assert.equal(isAutoAmount(31000, 28000, 1.1), false);
  assert.equal(isAutoAmount(null, 28000, 1.1), false);
  assert.equal(isAutoAmount(30800, null, 1.1), false);
});

test('priceKey: 출고일|품목', () => {
  assert.equal(priceKey('2026-11-14', '활전갱이'), '2026-11-14|활전갱이');
});
