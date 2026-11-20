import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollector, type SendResult } from './perf-collector.ts';
import type { PerfEvent } from './perf-payload.ts';

const ev = (n: number): PerfEvent => ({ metric: 'nav', valueMs: n, extraMs: null, page: '/x', monitor: null, pointer: null, platform: null, viewport: null, build: null, api: null });

function harness(results: SendResult[] | ((batch: PerfEvent[]) => SendResult), options = {}) {
  const sent: PerfEvent[][] = [];
  let i = 0;
  const c = createCollector(async (batch) => {
    sent.push(batch);
    return typeof results === 'function' ? results(batch) : (results[Math.min(i++, results.length - 1)] ?? 'ok');
  }, options);
  return { c, sent };
}

test('flush: 40건씩 나눠 보내고 버퍼를 비운다', async () => {
  const { c, sent } = harness(['ok'], { maxBuffer: 200 });
  for (let i = 0; i < 95; i += 1) c.push(ev(i));
  await c.flush();
  assert.deepEqual(sent.map((b) => b.length), [40, 40, 15]);
  assert.equal(c.size, 0);
});

test('push: 버퍼가 가득 차면 오래된 것부터 버린다', async () => {
  const { c, sent } = harness(['ok'], { maxBuffer: 5 });
  for (let i = 0; i < 8; i += 1) c.push(ev(i));
  assert.equal(c.size, 5);
  await c.flush();
  assert.deepEqual(sent[0].map((e) => e.valueMs), [3, 4, 5, 6, 7]);
});

test('서버가 disabled라고 하면 버퍼를 비우고 이후 기록도 받지 않는다', async () => {
  const { c, sent } = harness(['disabled']);
  c.push(ev(1));
  await c.flush();
  assert.equal(c.isDisabled, true);
  assert.equal(c.size, 0);
  c.push(ev(2));
  await c.flush();
  assert.equal(c.size, 0);
  assert.equal(sent.length, 1);
});

test('실패하면 그 묶음은 버리고 다음 flush에서 다시 시도하며, 연속 3번 실패하면 멈춘다', async () => {
  const { c, sent } = harness(['failed']);
  c.push(ev(1));
  await c.flush();
  assert.equal(c.isDisabled, false);
  assert.equal(c.size, 0); // 실패한 묶음은 버렸다
  c.push(ev(2));
  await c.flush();
  c.push(ev(3));
  await c.flush();
  assert.equal(c.isDisabled, true);
  assert.equal(sent.length, 3);
});

test('성공하면 연속 실패 횟수가 초기화된다', async () => {
  const { c } = harness(['failed', 'failed', 'ok', 'failed', 'failed']);
  for (let i = 0; i < 5; i += 1) {
    c.push(ev(i));
    await c.flush();
  }
  assert.equal(c.isDisabled, false);
});

test('send가 던져도 flush는 던지지 않고 실패로 센다', async () => {
  const c = createCollector(async () => {
    throw new Error('network');
  });
  c.push(ev(1));
  await assert.doesNotReject(c.flush());
  assert.equal(c.size, 0);
});

test('flush가 이미 진행 중이면 겹쳐 보내지 않는다', async () => {
  let calls = 0;
  let release: () => void = () => {};
  const c = createCollector(
    () =>
      calls++ === 0
        ? new Promise<SendResult>((resolve) => {
            release = () => resolve('ok');
          })
        : Promise.resolve<SendResult>('ok'),
  );
  c.push(ev(1));
  const first = c.flush();
  c.push(ev(2));
  await c.flush(); // 진행 중이라 바로 돌아온다
  assert.equal(calls, 1);
  release();
  await first; // 진행 중에 쌓인 기록은 같은 flush가 이어서 보낸다
  assert.equal(calls, 2);
  assert.equal(c.size, 0);
});

test('drain: 남은 기록을 40건씩 나눠 꺼내고 비운다(창을 닫을 때)', () => {
  const { c } = harness(['ok']);
  for (let i = 0; i < 85; i += 1) c.push(ev(i));
  const batches = c.drain();
  assert.deepEqual(batches.map((b) => b.length), [40, 40, 5]);
  assert.equal(c.size, 0);
  assert.deepEqual(c.drain(), []);
});
