import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSalesEdit } from './settlement/sales-edit.ts';

const original = { product: '활전갱이', quantity: 5, unit: '미' };

test('수정값이 없으면 원본을 쓰고 수정되지 않은 줄이다', () => {
  assert.deepEqual(resolveSalesEdit(original, undefined), { ...original, edited: false });
  assert.deepEqual(resolveSalesEdit(original, { productOverride: null, quantityOverride: null, unitOverride: null }), { ...original, edited: false });
});

test('고친 값이 원본보다 우선한다', () => {
  assert.deepEqual(resolveSalesEdit(original, { productOverride: '대광어', quantityOverride: 3, unitOverride: 'kg' }), { product: '대광어', quantity: 3, unit: 'kg', edited: true });
});

test('일부만 고쳐도 나머지는 원본이다', () => {
  assert.deepEqual(resolveSalesEdit(original, { productOverride: null, quantityOverride: 2, unitOverride: null }), { product: '활전갱이', quantity: 2, unit: '미', edited: true });
});
