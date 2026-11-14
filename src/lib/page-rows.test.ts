import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRows } from './page-rows.ts';

test('높이에 들어가는 만큼씩 쪽으로 나눈다(행 사이 간격 포함)', () => {
  // 50 + 8 + 50 + 8 + 50 = 166 ≤ 170, 다음 행은 넘는다
  assert.deepEqual(packRows([50, 50, 50, 50, 50], 170, 8), [[0, 1, 2], [3, 4]]);
});

test('모두 들어가면 한 쪽이다', () => {
  assert.deepEqual(packRows([40, 40], 500, 8), [[0, 1]]);
  assert.deepEqual(packRows([], 500, 8), [[]]);
});

test('행 높이가 달라도 순서를 지키며 나눈다', () => {
  assert.deepEqual(packRows([100, 30, 30, 120, 20], 170, 10), [[0, 1], [2, 3], [4]]);
});

test('혼자서도 높이보다 큰 행은 한 쪽을 혼자 쓴다', () => {
  assert.deepEqual(packRows([300, 40], 200, 8), [[0], [1]]);
});

test('높이를 아직 모르면(0) 한 쪽에 모두 둔다', () => {
  assert.deepEqual(packRows([50, 50, 50], 0, 8), [[0, 1, 2]]);
});

test('쪽마다 높이 합은 한도를 넘지 않는다', () => {
  const heights = [44, 72, 44, 44, 98, 44, 72, 44, 44];
  for (const avail of [180, 260, 400]) {
    for (const page of packRows(heights, avail, 8)) {
      const total = page.reduce((s, i) => s + heights[i], 0) + 8 * (page.length - 1);
      assert.ok(page.length === 1 || total <= avail, `${avail}: ${page}`);
    }
  }
});
