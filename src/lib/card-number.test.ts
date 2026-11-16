import test from 'node:test';
import assert from 'node:assert/strict';
import { cardNumberLabels } from './card-number.ts';

const general = (id: string, businessNumber: number) => ({ id, businessNumber, separate: false });
const separate = (id: string, businessNumber: number) => ({ id, businessNumber, separate: true });

test('발급 번호가 17번부터여도 화면 번호는 1번부터 빠짐없이 센다(11/16)', () => {
  const labels = cardNumberLabels([general('a', 17), general('b', 18), general('c', 19)]);
  assert.deepEqual([...labels.values()], ['1', '2', '3']);
});

test('목록 순서대로 센다: 순서를 바꾸면(끌기) 번호도 따라 바뀐다', () => {
  const before = cardNumberLabels([general('a', 17), general('b', 18)]);
  const after = cardNumberLabels([general('b', 18), general('a', 17)]);
  assert.equal(before.get('a'), '1');
  assert.equal(after.get('a'), '2');
  assert.equal(after.get('b'), '1');
});

test('중간이 비어 있어도(발급 번호 건너뜀) 빠짐없이 센다', () => {
  const labels = cardNumberLabels([general('a', 1), general('b', 5), general('c', 40)]);
  assert.deepEqual([...labels.values()], ['1', '2', '3']);
});

test('별도 주문은 일반 주문 번호에 끼지 않고 "별1, 별2…"로 따로 센다(발급 번호 501~은 쓰지 않는다)', () => {
  const labels = cardNumberLabels([general('a', 17), separate('s', 501), general('b', 18), separate('t', 502)]);
  assert.equal(labels.get('a'), '1');
  assert.equal(labels.get('b'), '2');
  assert.equal(labels.get('s'), '별1');
  assert.equal(labels.get('t'), '별2');
});

test('별도 주문의 발급 번호가 건너뛰어도 별1부터 빠짐없이 센다', () => {
  const labels = cardNumberLabels([separate('s', 505), separate('t', 520)]);
  assert.deepEqual([...labels.values()], ['별1', '별2']);
});

test('별도 주문 순서를 바꾸면 별 번호도 따라 바뀐다', () => {
  const labels = cardNumberLabels([separate('t', 502), separate('s', 501)]);
  assert.equal(labels.get('t'), '별1');
  assert.equal(labels.get('s'), '별2');
});

test('같은 업체의 1차·2차는 목록에서 별개 줄이라 각각 센다', () => {
  const labels = cardNumberLabels([general('r1', 3), general('r2', 20)]);
  assert.deepEqual([...labels.values()], ['1', '2']);
});

test('카드가 없으면 빈 결과', () => {
  assert.equal(cardNumberLabels([]).size, 0);
});
