import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBoxNeeds } from './packing/box-needs.ts';

test('제출한 업체는 제출한 박스로, 미제출 업체는 현재 구성으로 센다', () => {
  const needs = summarizeBoxNeeds(
    [
      { submittedNames: ['10K', '10K', '굴박스(대)'], plannedNames: ['20K'] }, // 제출했으므로 plannedNames는 무시
      { submittedNames: ['10K'], plannedNames: [] },
      { submittedNames: null, plannedNames: ['10K', '20K'] },
      { submittedNames: null, plannedNames: [] }, // 추천이 없는 업체
    ],
    ['10K', '15K', '20K', '굴박스(대)'],
  );
  assert.deepEqual(needs.lines, [
    { name: '10K', submitted: 3, planned: 1 },
    { name: '20K', submitted: 0, planned: 1 },
    { name: '굴박스(대)', submitted: 1, planned: 0 },
  ]);
  assert.deepEqual([needs.submittedTotal, needs.plannedTotal, needs.submittedRows, needs.rows], [4, 2, 2, 4]);
});

test('표시 순서는 박스 관리의 순서이고 목록에 없는 이름(삭제·이름 변경)은 뒤에 가나다순이다', () => {
  const needs = summarizeBoxNeeds(
    [{ submittedNames: ['옛박스', '15K', '가박스', '10K'], plannedNames: [] }],
    ['10K', '15K'],
  );
  assert.deepEqual(needs.lines.map((l) => l.name), ['10K', '15K', '가박스', '옛박스']);
});

test('업체가 없으면 빈 집계다', () => {
  assert.deepEqual(summarizeBoxNeeds([], ['10K']), { lines: [], submittedTotal: 0, plannedTotal: 0, submittedRows: 0, rows: 0 });
});
