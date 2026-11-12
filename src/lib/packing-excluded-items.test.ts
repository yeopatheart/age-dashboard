import test from 'node:test';
import assert from 'node:assert/strict';
import { excludedReason } from './packing/excluded-items.ts';

test('남은 수량이 있으면 박스에 담을 상품이다', () => {
  assert.equal(excludedReason(3, '미', 0), null);
  assert.equal(excludedReason(3, '미', 2), null);
});

test('수량을 비워 저장한 상품은 수량 미정이다', () => {
  assert.equal(excludedReason(0, '', 0), 'undecided');
});

test('주문 전량이 미출고면 전량 미출고다', () => {
  assert.equal(excludedReason(3, '미', 3), 'unshipped');
});

test('수량 0이어도 단위가 있으면 수량 미정으로 보지 않는다', () => {
  assert.equal(excludedReason(0, '미', 0), 'unshipped');
});
