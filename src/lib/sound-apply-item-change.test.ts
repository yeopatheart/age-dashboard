import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyItemChange } from './sound/apply-item-change.ts';
import { diffOrders, type OrderSnapshot } from './sound/order-events.ts';

const snapshot = (): OrderSnapshot => ({
  rows: [{ dailyBusinessId: 'd1', businessName: '가게', round: 1, memo: null, terminal: '대구' }],
  items: [
    { id: 'i1', dailyBusinessId: 'd1', productName: '활전갱이', quantity: 2, unit: '미', isMulbong: false, hasAerator: false, isPacked: false, unshippedQuantity: 0, changeStatus: 'none' },
  ],
});
const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1', daily_business_id: 'd1', product_name_raw: '활전갱이', quantity: 2, unit: '미', secondary_weight_kg: null, size_request: null,
  is_mulbong: false, has_aerator: false, is_packed: false, unshipped_quantity: 0, change_status: 'none', ...over,
});

test('실시간 신호: 포장 체크는 서버 데이터를 기다리지 않고 "포장 체크" 이벤트가 된다', () => {
  const prev = snapshot();
  const next = applyItemChange(prev, { eventType: 'UPDATE', new: row({ is_packed: true }), old: {} });
  assert.ok(next);
  // 줄이 하나뿐인 카드라 포장 체크는 업체 전체 포장 완료도 함께 만든다.
  assert.deepEqual(diffOrders(prev, next).map((e) => [e.kind, e.business, e.product]), [['item-packed', '가게', '활전갱이'], ['card-complete', '가게', undefined]]);
});

test('실시간 신호: 수량이 바뀌고, 포장된 줄이 바뀌면 급한 이벤트다', () => {
  const prev = snapshot();
  const q = applyItemChange(prev, { eventType: 'UPDATE', new: row({ quantity: '5' }), old: {} });
  assert.deepEqual(diffOrders(prev, q!).map((e) => e.kind), ['qty-changed']);
  const packed = { ...prev, items: [{ ...prev.items[0], isPacked: true }] };
  const q2 = applyItemChange(packed, { eventType: 'UPDATE', new: row({ is_packed: true, quantity: 9 }), old: {} });
  assert.deepEqual(diffOrders(packed, q2!).map((e) => e.kind), ['packed-item-changed']);
});

test('실시간 신호: 취소·추가·삭제', () => {
  const prev = snapshot();
  const cancelled = applyItemChange(prev, { eventType: 'UPDATE', new: row({ change_status: 'cancelled' }), old: {} });
  assert.deepEqual(diffOrders(prev, cancelled!).map((e) => e.kind), ['item-cancelled']);
  const added = applyItemChange(prev, { eventType: 'INSERT', new: row({ id: 'i2', product_name_raw: '방어', change_status: 'new' }), old: {} });
  assert.deepEqual(diffOrders(prev, added!).map((e) => [e.kind, e.product]), [['item-added', '방어']]);
  const deleted = applyItemChange(prev, { eventType: 'DELETE', new: {}, old: { id: 'i1' } });
  assert.deepEqual(diffOrders(prev, deleted!).map((e) => e.kind), ['item-cancelled']);
});

test('실시간 신호: 화면에 없는 카드·모르는 줄은 건드리지 않고 null(서버 데이터가 알린다)', () => {
  const prev = snapshot();
  assert.equal(applyItemChange(prev, { eventType: 'INSERT', new: row({ id: 'x', daily_business_id: 'other' }), old: {} }), null);
  assert.equal(applyItemChange(prev, { eventType: 'UPDATE', new: row({ id: 'unknown' }), old: {} }), null);
  assert.equal(applyItemChange(prev, { eventType: 'DELETE', new: {}, old: { id: 'unknown' } }), null);
  assert.equal(applyItemChange(prev, { eventType: 'INSERT', new: row(), old: {} }), null); // 이미 아는 줄
});

test('실시간 신호로 반영한 스냅샷은 같은 변경의 서버 스냅샷과 비교해도 이벤트가 없다', () => {
  const prev = snapshot();
  const viaSignal = applyItemChange(prev, { eventType: 'UPDATE', new: row({ quantity: 4, unshipped_quantity: 1, size_request: '선별' }), old: {} })!;
  const fromServer: OrderSnapshot = { ...prev, items: [{ ...prev.items[0], quantity: 4, unshippedQuantity: 1, sizeRequest: '선별' }] };
  assert.deepEqual(diffOrders(viaSignal, fromServer), []);
});
