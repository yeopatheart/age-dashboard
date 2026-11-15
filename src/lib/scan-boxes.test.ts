import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardBoxes } from './scan-boxes.ts';

const label = (seq: number, loaded: boolean) => ({ seq, loaded_at: loaded ? '2026-11-15T01:00:00Z' : null });

test('라벨을 일부만 출력했으면 라벨 없는 박스는 상차 안 된 박스로 센다 (1/2, 이 업체 상차 완료 아님)', () => {
  const boxes = cardBoxes([label(1, true)], 2);
  assert.equal(boxes.length, 2);
  assert.equal(boxes.filter((b) => b.loaded).length, 1);
});

test('박스를 줄여 다시 제출했으면 번호를 넘는 옛 라벨 행은 세지 않는다 (2/2, "2/3"에서 멈추지 않음)', () => {
  const boxes = cardBoxes([label(1, true), label(2, true), label(3, false)], 2);
  assert.deepEqual(boxes, [{ seq: 1, loaded: true }, { seq: 2, loaded: true }]);
});

test('박스를 늘렸는데 새 라벨을 아직 안 뽑았으면 새 박스는 상차 전이다', () => {
  const boxes = cardBoxes([label(1, true), label(2, true)], 3);
  assert.equal(boxes.length, 3);
  assert.equal(boxes[2].loaded, false);
});

test('제출 기록이 없으면(기록 삭제 뒤) 라벨 행 기준으로 센다', () => {
  assert.deepEqual(cardBoxes([label(1, true), label(3, false)], null), [{ seq: 1, loaded: true }, { seq: 3, loaded: false }]);
  assert.deepEqual(cardBoxes([], null), []);
});
