import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSentTime, hashText, latestByKey, sentLabel, sentState, type DispatchLogRow, type SentEntry } from './dispatch-log.ts';

const row = (over: Partial<DispatchLogRow>): DispatchLogRow => ({ kind: 'driver', key: '대구', method: 'share', contentHash: 'aaaaaaaa', sentAt: '2026-11-10T05:00:00.000Z', ...over });

test('hashText: 같은 글은 같은 값, 한 글자만 달라도 다른 값', () => {
  assert.equal(hashText('대구 상차 완료'), hashText('대구 상차 완료'));
  assert.notEqual(hashText('대구 상차 완료'), hashText('대구 상차 완료 '));
  assert.match(hashText(''), /^[0-9a-f]{8}$/);
});

test('latestByKey: key마다 가장 늦은 기록만 남기고 입력 순서와 무관하다', () => {
  const rows = [
    row({ key: '대구', method: 'copy', sentAt: '2026-11-10T06:00:00.000Z' }),
    row({ key: '대구', method: 'share', sentAt: '2026-11-10T05:00:00.000Z' }),
    row({ key: '인천', sentAt: '2026-11-10T04:00:00.000Z' }),
  ];
  for (const input of [rows, [...rows].reverse()]) {
    const out = latestByKey(input, 'driver');
    assert.equal(out['대구'].method, 'copy');
    assert.equal(out['인천'].method, 'share');
  }
});

test('latestByKey: 다른 kind의 기록은 섞이지 않는다', () => {
  const out = latestByKey([row({ kind: 'receipt', key: 'r1:0' })], 'driver');
  assert.deepEqual(out, {});
});

test('sentState: 기록 없음 / 보냄 / 보낸 뒤 변경됨', () => {
  const entry: SentEntry = { method: 'share', hash: 'aaaaaaaa', sentAt: '2026-11-10T05:00:00.000Z' };
  assert.equal(sentState(undefined, 'aaaaaaaa'), 'none');
  assert.equal(sentState(entry, 'aaaaaaaa'), 'sent');
  assert.equal(sentState(entry, 'bbbbbbbb'), 'changed');
});

test('sentState: 해시가 없으면(영수증) 변경으로 보지 않는다', () => {
  assert.equal(sentState({ method: 'share', hash: null, sentAt: '2026-11-10T05:00:00.000Z' }, undefined), 'sent');
  assert.equal(sentState({ method: 'share', hash: null, sentAt: '2026-11-10T05:00:00.000Z' }, 'bbbbbbbb'), 'sent');
});

test('formatSentTime: 한국 시각 HH:MM (UTC 05:07 → 14:07, 자정 넘김)', () => {
  assert.equal(formatSentTime('2026-11-10T05:07:00.000Z'), '14:07');
  assert.equal(formatSentTime('2026-11-10T15:30:00.000Z'), '00:30');
  assert.equal(formatSentTime('not a date'), '');
});

test('sentLabel: 공유는 보냄, 복사는 복사, 변경되면 이후 변경됨', () => {
  const share: SentEntry = { method: 'share', hash: 'a', sentAt: '2026-11-10T05:07:00.000Z' };
  const copy: SentEntry = { ...share, method: 'copy' };
  assert.equal(sentLabel(share, 'sent'), '보냄 ✓ 14:07');
  assert.equal(sentLabel(copy, 'sent'), '복사 ✓ 14:07');
  assert.equal(sentLabel(share, 'changed'), '보냄 14:07 이후 변경됨');
  assert.equal(sentLabel(undefined, 'none'), null);
});
