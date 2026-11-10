import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerMessage, formatMessageDate, groupSettledCustomers, type MessageRow } from './customer-message.ts';

const row = (customer: string, product: string, quantity: number, unit: string, price: number | null): MessageRow => ({ customer, product, quantity, unit, price });

test('formatMessageDate: 앞의 0을 쓰지 않는다', () => {
  assert.equal(formatMessageDate('2026-11-09'), '11/9');
  assert.equal(formatMessageDate('2026-01-05'), '1/5');
  assert.equal(formatMessageDate('2026-12-31'), '12/31');
});

test('groupSettledCustomers: 모든 줄에 판매가가 있는 고객사만 settled, 합계는 줄 금액의 합', () => {
  const { settled, pending } = groupSettledCustomers([
    row('엔야', '활전갱이', 3, '미', 39000),
    row('바다횟집', '생굴', 1, '키로', null),
    row('엔야', '버스', 1, '박스', 10000),
    row('바다횟집', '활고등어', 2, '키로', 51000),
  ]);
  assert.deepEqual(settled.map((s) => [s.customer, s.total, s.rows.length]), [['엔야', 49000, 2]]);
  assert.deepEqual(pending, ['바다횟집']);
});

test('groupSettledCustomers: 판매가 0원은 입력 완료로 본다, 빈 입력은 줄이 없는 것', () => {
  const { settled, pending } = groupSettledCustomers([row('엔야', '덤', 1, '개', 0)]);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].total, 0);
  assert.deepEqual(groupSettledCustomers([]), { settled: [], pending: [] });
  assert.deepEqual(pending, []);
});

test('groupSettledCustomers: 고객사는 처음 나온 순서를 지킨다', () => {
  const { settled } = groupSettledCustomers([row('나', 'a', 1, '개', 1), row('가', 'b', 1, '개', 2), row('나', 'c', 1, '개', 3)]);
  assert.deepEqual(settled.map((s) => s.customer), ['나', '가']);
});

test('buildCustomerMessage: 예시 형식 그대로(번호, 상품 수량 : 금액, 천 단위 쉼표)', () => {
  const { settled } = groupSettledCustomers([
    row('엔야', '활전갱이', 3, '미', 39000),
    row('엔야', '일산중방어', 5.4, '키로', 167000),
    row('엔야', '버스', 1, '박스', 10000),
  ]);
  assert.equal(
    buildCustomerMessage('2026-11-09', settled[0]),
    ['감사합니다.', '11/9 엔야 - 총 216,000', '1. 활전갱이 3미 : 39,000', '2. 일산중방어 5.4키로 : 167,000', '3. 버스 1박스 : 10,000'].join('\n'),
  );
});
