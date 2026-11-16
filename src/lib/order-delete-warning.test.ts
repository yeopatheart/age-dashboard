import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_DELETE_BASE_MESSAGE, orderDeleteMessage } from './order-delete-warning.ts';

test('박스·라벨 기록이 없으면 기존 문구 그대로다', () => {
  assert.equal(orderDeleteMessage({ submittedBoxes: 0, labels: 0, loadedLabels: 0 }), ORDER_DELETE_BASE_MESSAGE);
});

test('제출한 박스와 라벨 수, 상차 완료 수를 문구에 보여 준다', () => {
  const m = orderDeleteMessage({ submittedBoxes: 3, labels: 3, loadedLabels: 2 });
  assert.ok(m.startsWith(ORDER_DELETE_BASE_MESSAGE));
  assert.match(m, /제출한 박스 3개/);
  assert.match(m, /발급된 라벨 3장\(상차 완료 2장\)/);
  assert.match(m, /되돌릴 수 없습니다/);
  assert.match(m, /출력된 적 없는 번호/);
});

test('박스만 제출하고 라벨이 없으면 스티커 안내는 빼고 상차 수도 붙이지 않는다', () => {
  const m = orderDeleteMessage({ submittedBoxes: 2, labels: 0, loadedLabels: 0 });
  assert.match(m, /제출한 박스 2개/);
  assert.doesNotMatch(m, /발급된 라벨/);
  assert.doesNotMatch(m, /스티커/);
});

test('라벨은 있고 상차한 것이 없으면 상차 완료 수를 붙이지 않는다', () => {
  const m = orderDeleteMessage({ submittedBoxes: 1, labels: 1, loadedLabels: 0 });
  assert.match(m, /발급된 라벨 1장/);
  assert.doesNotMatch(m, /상차 완료 \d/);
});

test('기록을 확인하지 못했으면 지워질 수 있다고 알린다', () => {
  const m = orderDeleteMessage(null);
  assert.match(m, /확인하지 못했습니다/);
  assert.match(m, /되돌릴 수 없습니다/);
});
