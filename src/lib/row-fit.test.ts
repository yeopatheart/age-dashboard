import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRowHeight } from './row-fit.ts';

test('a small leftover is absorbed by shrinking the rows a little to fit one more row', () => {
  // 565px에 40px 행은 14행 + 5px가 남는다 → 15행, 행 높이 37px
  assert.deepEqual(fitRowHeight(565, 40, 30, 6), { rowHeight: 37, capacity: 15 });
});

test('a large leftover also adds one row, with only a tiny shrink', () => {
  // 595px: 14행 + 35px → 15행, 39px
  assert.deepEqual(fitRowHeight(595, 40, 30, 6), { rowHeight: 39, capacity: 15 });
});

test('an exact fit is left alone', () => {
  assert.deepEqual(fitRowHeight(560, 40, 30, 6), { rowHeight: 40, capacity: 14 });
});

test('no row is added when the rows would have to shrink more than the limit', () => {
  // 150px, 40px 행: 3행 + 30px → 4행이면 37px(3px 줄임) → 허용. 한도를 2px로 두면 그대로.
  assert.deepEqual(fitRowHeight(150, 40, 30, 6), { rowHeight: 37, capacity: 4 });
  assert.deepEqual(fitRowHeight(150, 40, 30, 2), { rowHeight: 40, capacity: 3 });
});

test('no row is added when rows would fall below the readable minimum', () => {
  // 30px 행(가장 작은 단계)은 더 줄이지 않는다
  assert.deepEqual(fitRowHeight(575, 30, 30, 6), { rowHeight: 30, capacity: 19 });
  // 32px 행에서 한 행을 더 넣으면 29px로 내려가는 경우(325/11)
  assert.deepEqual(fitRowHeight(325, 32, 30, 6), { rowHeight: 32, capacity: 10 });
  // 같은 단계라도 넉넉하면 한 행을 더 넣는다(607/19 = 31px)
  assert.deepEqual(fitRowHeight(607, 32, 30, 6), { rowHeight: 31, capacity: 19 });
});

test('the result always fills the available height without overflowing', () => {
  for (const avail of [300, 333, 478, 565, 612, 700, 777]) {
    for (const tier of [40, 36, 32, 30]) {
      const { rowHeight, capacity } = fitRowHeight(avail, tier, 30, 6);
      assert.ok(rowHeight * capacity <= avail, `${avail}/${tier}`);
      assert.ok(rowHeight >= 30 || capacity === Math.max(1, Math.floor(avail / tier)));
    }
  }
});

test('a tiny height still gives one row', () => {
  assert.deepEqual(fitRowHeight(20, 40, 30, 6), { rowHeight: 40, capacity: 1 });
});
