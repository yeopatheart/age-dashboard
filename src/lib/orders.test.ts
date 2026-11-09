import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessIdsInBothRounds, nameWithRound, roundLabel } from './orders.ts';

test('1·2차가 둘 다 있는 업체만 이름에 차수를 붙인다', () => {
  const split = businessIdsInBothRounds([
    { businessId: 'a', round: 1 },
    { businessId: 'a', round: 2 },
    { businessId: 'b', round: 1 },
    { businessId: 'c', round: 2 },
  ]);
  assert.deepEqual([...split], ['a']);
  assert.equal(nameWithRound('바다향횟집', 1, split.has('a')), '바다향횟집 1차');
  assert.equal(nameWithRound('바다향횟집', 2, split.has('a')), '바다향횟집 2차');
  assert.equal(nameWithRound('청해수산', 1, split.has('b')), '청해수산');
  assert.equal(nameWithRound('갯마을수산', 2, split.has('c')), '갯마을수산');
});

test('차수 값이 이상하면 1차로 본다', () => {
  assert.equal(nameWithRound('x', 0, true), 'x 1차');
  assert.equal(nameWithRound('x', 3, true), 'x 1차');
  assert.equal(roundLabel(2), '2차');
});
