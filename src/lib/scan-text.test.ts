import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undoneSummary } from './scan-text.ts';

test('상차 취소 문구에 업체와 박스 번호가 들어간다', () => {
  assert.deepEqual(undoneSummary({ business: '청해수산', boxNo: 2, mergedSeqs: [] }), {
    title: '청해수산 2번 상차를 취소했습니다',
    detail: '이 박스는 다시 상차 전 상태입니다.',
  });
});

test('합포장이면 함께 취소된 박스 번호를 알려 준다', () => {
  assert.deepEqual(undoneSummary({ business: '마린호텔', boxNo: 2, mergedSeqs: [1, 2] }), {
    title: '마린호텔 2번 상차를 취소했습니다',
    detail: '이 박스들은 다시 상차 전 상태입니다. · 합포장 1·2번 함께 취소',
  });
});
