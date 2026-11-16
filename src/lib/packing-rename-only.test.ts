import test from 'node:test';
import assert from 'node:assert/strict';
import { isRenameOnly, orderChangedAfterSubmit } from './packing/rename-only.ts';

const live = [
  { id: 'a', unit: '미', quantity: 3 },
  { id: 'b', unit: 'kg', quantity: 1.5 },
];

test('줄 수·단위·수량이 제출한 박스와 같으면(이름만 다름) 이름만 바뀐 것이다', () => {
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: '미', quantity: 3 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }]), true);
});

test('한 줄이 여러 박스에 나뉘어 담겨도 합이 같으면 같다', () => {
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: '미', quantity: 1 }, { orderItemId: 'a', unit: '미', quantity: 2 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }]), true);
});

test('수량이 바뀌었으면 아니다', () => {
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: '미', quantity: 2 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }]), false);
});

test('단위가 바뀌었으면 아니다', () => {
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: 'kg', quantity: 3 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }]), false);
});

test('줄이 추가되었거나 빠졌으면 아니다', () => {
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: '미', quantity: 3 }]), false);
  assert.equal(isRenameOnly([live[0]], [{ orderItemId: 'a', unit: '미', quantity: 3 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }]), false);
});

test('제출한 줄이 다른 줄로 바뀌었거나(지우고 새로 입력) 연결이 끊겼으면 아니다', () => {
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: '미', quantity: 3 }, { orderItemId: 'x', unit: 'kg', quantity: 1.5 }]), false);
  assert.equal(isRenameOnly(live, [{ orderItemId: 'a', unit: '미', quantity: 3 }, { orderItemId: null, unit: 'kg', quantity: 1.5 }]), false);
});

test('기록이 없으면 아니다(모르면 경고한다)', () => {
  assert.equal(isRenameOnly(live, []), false);
  assert.equal(isRenameOnly([], [{ orderItemId: 'a', unit: '미', quantity: 3 }]), false);
});

test('소수 둘째 자리 오차는 같은 수량으로 본다', () => {
  assert.equal(isRenameOnly([{ id: 'a', unit: 'kg', quantity: 0.1 + 0.2 }], [{ orderItemId: 'a', unit: 'kg', quantity: 0.3 }]), true);
});

const sameAsLive = [{ orderItemId: 'a', unit: '미', quantity: 3 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }];

test('제출 지문이 없거나 지금과 같으면 바뀐 것이 아니다', () => {
  assert.equal(orderChangedAfterSubmit(null, 'x', live, sameAsLive), false);
  assert.equal(orderChangedAfterSubmit('x', 'x', live, []), false);
});

test('지문은 다르지만 이름만 바뀐 것이면 바뀐 것으로 보지 않는다(박스 할당 화면의 "주문 변경" 칩)', () => {
  assert.equal(orderChangedAfterSubmit('old', 'new', live, sameAsLive), false);
});

test('지문이 다르고 수량·줄 수가 달라졌으면 바뀐 것이다', () => {
  assert.equal(orderChangedAfterSubmit('old', 'new', live, [{ orderItemId: 'a', unit: '미', quantity: 2 }, { orderItemId: 'b', unit: 'kg', quantity: 1.5 }]), true);
  assert.equal(orderChangedAfterSubmit('old', 'new', live, [{ orderItemId: 'a', unit: '미', quantity: 3 }]), true);
});

test('제출한 박스에 담긴 줄이 하나도 없으면(읽지 못한 경우 포함) 바뀐 것으로 본다', () => {
  assert.equal(orderChangedAfterSubmit('old', 'new', live, []), true);
});
