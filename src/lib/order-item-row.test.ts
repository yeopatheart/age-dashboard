import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOrderItemRow, type NewOrderItemInput } from './order-item-row.ts';

const product: NewOrderItemInput['product'] = {
  productName: '활전갱이', quantity: 3, unit: '미', secondaryWeightKg: null, sizeRequest: null,
  isMulbong: false, hasAerator: false, mulbongBoxCount: null, hasIcePack: false, fromStock: false, needsReview: false,
};
const sizeSpec: NewOrderItemInput['sizeSpec'] = { minG: null, maxG: null, relative: null, grade: null, handling: [], pending: false, optional: false, unparsed: [] };
const base = { dailyBusinessId: 'd1', sequence: 1, product, sizeSpec, isFirstInputOfDay: true, userId: 'u1' };

test('AI가 고친 줄과 일반 줄이 같은 열 조합을 가진다 (여러 줄 insert에서 열이 NULL로 채워지지 않게)', () => {
  const plain = newOrderItemRow({ ...base, aiRepaired: false });
  const repaired = newOrderItemRow({ ...base, aiRepaired: true });
  assert.deepEqual(Object.keys(plain).sort(), Object.keys(repaired).sort());
  assert.equal(plain.ai_repaired, false);
  assert.equal(repaired.ai_repaired, true);
});

test('선택 값이 없는 줄도 열을 빼지 않고 null로 채운다', () => {
  const row = newOrderItemRow({ ...base, aiRepaired: false, userId: null });
  for (const [key, value] of Object.entries(row)) assert.notEqual(value, undefined, `${key}가 undefined`);
  assert.equal(row.review_reason, null);
  assert.equal(row.created_by, null);
});

test('그날 첫 입력이면 최초주문(none), 이후면 추가됨(new)', () => {
  assert.equal(newOrderItemRow({ ...base, aiRepaired: false, isFirstInputOfDay: true }).change_status, 'none');
  assert.equal(newOrderItemRow({ ...base, aiRepaired: false, isFirstInputOfDay: false }).change_status, 'new');
});
