import test from 'node:test';
import assert from 'node:assert/strict';
import { jobIdFromTitle, normalizeConfirmMode, pendingSeqsOf, printJobTitle } from './labels/print-job.ts';

const ID = '3f2a9c1e-7b4d-4e0a-9d51-0c8e6f1a2b34';

test('작업 제목에서 작업 id를 되찾는다(앞뒤에 다른 글자가 붙어도)', () => {
  assert.equal(jobIdFromTitle(printJobTitle(ID)), ID);
  assert.equal(jobIdFromTitle(`Document - ${printJobTitle(ID.toUpperCase())} - Chrome`), ID);
  assert.equal(jobIdFromTitle('통영 라벨'), null);
  assert.equal(jobIdFromTitle('AGE-LABEL-not-a-uuid'), null);
});

test('확정 방식은 spooler만 인정하고 나머지는 button이다', () => {
  assert.equal(normalizeConfirmMode('spooler'), 'spooler');
  assert.equal(normalizeConfirmMode('button'), 'button');
  assert.equal(normalizeConfirmMode(undefined), 'button');
  assert.equal(normalizeConfirmMode(true), 'button');
});

test('출력 확인 중인 박스: 오래된 작업과 다른 업체는 뺀다', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  const item = (daily: string, seq: number) => ({ daily_business_id: daily, seq, barcode: '0', printed_box_type: null });
  const jobs = [
    { createdAt: '2026-11-14T09:50:00Z', items: [item('a', 2), item('a', 1), item('b', 1)] },
    { createdAt: '2026-11-14T09:20:00Z', items: [item('a', 3)] }, // 40분 전 → 확인 실패로 본다
  ];
  assert.deepEqual(pendingSeqsOf(jobs, 'a', now), [1, 2]);
  assert.deepEqual(pendingSeqsOf(jobs, 'c', now), []);
});
