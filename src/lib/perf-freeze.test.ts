import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFreezes, type FreezeEntry } from './perf-freeze.ts';

const e = (startTime: number, duration: number, blockingDuration = Math.max(0, duration - 50)): FreezeEntry => ({ startTime, duration, blockingDuration });

test('summarizeFreezes: 구간 안 기록 중 가장 긴 것과 막은 시간의 합계', () => {
  const r = summarizeFreezes([e(100, 300), e(900, 4000), e(5000, 120)], 0, 10_000);
  assert.equal(r.maxMs, 4000);
  assert.equal(r.blockedMs, 250 + 3950 + 70);
});

test('summarizeFreezes: 구간 밖(시작 전·끝 이후) 기록은 세지 않는다. 시작은 포함, 끝은 제외', () => {
  const r = summarizeFreezes([e(99, 1000), e(100, 200), e(199.9, 300), e(200, 9000)], 100, 200);
  assert.equal(r.maxMs, 300);
  assert.equal(r.blockedMs, 150 + 250);
});

test('summarizeFreezes: 기록이 없으면 0', () => {
  assert.deepEqual(summarizeFreezes([], 0, 10_000), { maxMs: 0, blockedMs: 0 });
});

test('summarizeFreezes: 음수 blockingDuration은 0으로 본다, 결과는 정수', () => {
  assert.deepEqual(summarizeFreezes([e(0, 100.4, -5), e(10, 60.6, 10.2)], 0, 100), { maxMs: 100, blockedMs: 10 });
});
