import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyChangeInScope, itemChangeInScope, type LiveScope } from './realtime/change-scope.ts';

const scope: LiveScope = { orderDate: '2026-11-14', dailyIds: new Set(['d1', 'd2']), itemIds: new Set(['i1', 'i2']) };
const none = new Set<string>();

test('업체 카드 변경: 이 날짜의 새 카드와 이 화면의 카드만 해당한다', () => {
  assert.equal(dailyChangeInScope(scope, { eventType: 'INSERT', new: { id: 'd9', order_date: '2026-11-14' }, old: {} }), true);
  assert.equal(dailyChangeInScope(scope, { eventType: 'INSERT', new: { id: 'd9', order_date: '2026-11-01' }, old: {} }), false);
  assert.equal(dailyChangeInScope(scope, { eventType: 'UPDATE', new: { id: 'd1', order_date: '2026-11-15' }, old: { id: 'd1' } }), true); // 다른 날짜로 옮겨도 이 화면에서 빠져야 한다
  assert.equal(dailyChangeInScope(scope, { eventType: 'DELETE', new: {}, old: { id: 'd2' } }), true);
  assert.equal(dailyChangeInScope(scope, { eventType: 'DELETE', new: {}, old: { id: 'd9' } }), false);
});

test('주문 줄 변경: 이 화면의 카드에 속한 줄, 방금 들어온 카드의 줄, 이 화면에 있던 줄의 삭제만 해당한다', () => {
  assert.equal(itemChangeInScope(scope, { eventType: 'UPDATE', new: { id: 'i1', daily_business_id: 'd1' }, old: { id: 'i1' } }, none), true);
  assert.equal(itemChangeInScope(scope, { eventType: 'INSERT', new: { id: 'i9', daily_business_id: 'd9' }, old: {} }, none), false);
  assert.equal(itemChangeInScope(scope, { eventType: 'INSERT', new: { id: 'i9', daily_business_id: 'd9' }, old: {} }, new Set(['d9'])), true);
  assert.equal(itemChangeInScope(scope, { eventType: 'DELETE', new: {}, old: { id: 'i2' } }, none), true);
  assert.equal(itemChangeInScope(scope, { eventType: 'DELETE', new: {}, old: { id: 'i9' } }, none), false);
});

test('판단할 정보가 없으면 새로 받는다', () => {
  assert.equal(dailyChangeInScope(scope, { eventType: 'UPDATE', new: {}, old: {} }), true);
  assert.equal(dailyChangeInScope(scope, { eventType: 'UPDATE', new: { id: 'd9' }, old: {} }), true); // 날짜를 모르는 카드
  assert.equal(itemChangeInScope(scope, { eventType: 'UPDATE', new: {}, old: {} }, none), true);
});
