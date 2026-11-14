import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeKey, mergeUids, pruneUidGroups, seqGroupsFromUid, uidGroupsFromSeq, unmergeUids } from './packing/merge-draft.ts';
import { unprintedSeqs } from './label-status.ts';

const uids = ['a', 'b', 'c', 'd', 'e'];

test('번호 묶음과 uid 묶음을 오갈 수 있다', () => {
  const groups = uidGroupsFromSeq(uids, [[1, 2], [4, 5]]);
  assert.deepEqual(groups, [['a', 'b'], ['d', 'e']]);
  assert.deepEqual(seqGroupsFromUid(uids, groups), [[1, 2], [4, 5]]);
});

test('박스를 지우면 묶음이 남은 박스를 따라가고 2개 미만이 된 묶음은 사라진다', () => {
  const groups = [['a', 'b'], ['d', 'e']];
  const after = uids.filter((u) => u !== 'a'); // 1번 박스 삭제 → b=1, c=2, d=3, e=4
  assert.deepEqual(pruneUidGroups(groups, after), [['d', 'e']]);
  assert.deepEqual(seqGroupsFromUid(after, groups), [[3, 4]]); // 번호는 앞당겨진 순서로 다시 센다
});

test('선택한 박스를 묶으면 다른 묶음에서 빠지고, 2개 미만이면 묶지 않는다', () => {
  assert.deepEqual(mergeUids([['a', 'b', 'c']], ['c', 'd']), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(mergeUids([['a', 'b']], ['c']), [['a', 'b']]);
  assert.deepEqual(mergeUids([['a', 'b', 'c']], ['b', 'c']), [['b', 'c']]);
  assert.deepEqual(unmergeUids([['a', 'b'], ['d', 'e']], ['a', 'b']), [['d', 'e']]);
});

test('비교용 키는 묶음 순서와 무관하다', () => {
  assert.equal(mergeKey(uids, [['d', 'e'], ['a', 'b']]), mergeKey(uids, [['a', 'b'], ['d', 'e']]));
  assert.notEqual(mergeKey(uids, [['a', 'b']]), mergeKey(uids, []));
});

test('일괄 출력 대상은 아직 출력하지 않은 순번뿐이다', () => {
  assert.deepEqual(unprintedSeqs(4, [1, 3]), [2, 4]);
  assert.deepEqual(unprintedSeqs(3, []), [1, 2, 3]);
  assert.deepEqual(unprintedSeqs(2, [1, 2, 7]), []); // total보다 큰 순번 기록은 무시
  assert.deepEqual(unprintedSeqs(0, []), []);
});
