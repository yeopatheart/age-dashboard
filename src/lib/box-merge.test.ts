import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGroupOf, mergeLabelText, mergeSelected, normalizeMergeGroups, unmergeGroup } from './box-merge.ts';

test('normalizeMergeGroups drops invalid input and singleton groups', () => {
  assert.deepEqual(normalizeMergeGroups('nope'), []);
  assert.deepEqual(normalizeMergeGroups([[1], [2, 2]]), []);
  assert.deepEqual(normalizeMergeGroups([[3, 1, 2, 2, 0, 100, 1.5]]), [[1, 2, 3]]);
});

test('a box belongs to the earlier group when groups overlap', () => {
  assert.deepEqual(normalizeMergeGroups([[1, 2], [2, 3]]), [[1, 2]]);
});

test('maxBox removes boxes beyond the current box count', () => {
  assert.deepEqual(normalizeMergeGroups([[1, 2, 5]], 3), [[1, 2]]);
});

test('mergeSelected moves boxes out of their old group', () => {
  assert.deepEqual(mergeSelected([[1, 2, 3]], [3, 4]), [[1, 2], [3, 4]]);
});

test('label text and lookup', () => {
  assert.equal(mergeLabelText([[1, 2]], 2), '합포장 1·2');
  assert.equal(mergeLabelText([[1, 2]], 3), '');
  assert.deepEqual(mergeGroupOf([[1, 2]], 1), [1, 2]);
  assert.deepEqual(unmergeGroup([[1, 2], [4, 5]], [1, 2]), [[4, 5]]);
});
