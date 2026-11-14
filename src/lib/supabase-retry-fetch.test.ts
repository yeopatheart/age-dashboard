import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetryingFetch, MAX_ATTEMPTS } from './supabase/retry-fetch.ts';

const ok = () => new Response('ok', { status: 200 });
const sleep = async () => {};

test('읽기 요청은 네트워크 오류가 나면 다시 시도해서 성공하면 그 응답을 돌려준다', async () => {
  let calls = 0;
  const f = createRetryingFetch(async () => {
    calls++;
    if (calls < 3) throw new TypeError('fetch failed');
    return ok();
  }, { sleep });
  const res = await f('https://x.test/rest/v1/a', { method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test('읽기 요청은 502·503·504면 다시 시도하고, 계속 실패하면 마지막 응답을 그대로 돌려준다', async () => {
  let calls = 0;
  const f = createRetryingFetch(async () => {
    calls++;
    return new Response('bad gateway', { status: 502 });
  }, { sleep });
  const res = await f('https://x.test/rest/v1/a');
  assert.equal(res.status, 502);
  assert.equal(calls, MAX_ATTEMPTS);
});

test('4xx 같은 정상적인 거절은 다시 시도하지 않는다', async () => {
  let calls = 0;
  const f = createRetryingFetch(async () => {
    calls++;
    return new Response('nope', { status: 401 });
  }, { sleep });
  assert.equal((await f('https://x.test/auth')).status, 401);
  assert.equal(calls, 1);
});

test('쓰기 요청은 실패해도 다시 보내지 않는다(같은 주문이 두 번 들어가면 안 된다)', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    let calls = 0;
    const f = createRetryingFetch(async () => {
      calls++;
      throw new TypeError('fetch failed');
    }, { sleep });
    await assert.rejects(() => f('https://x.test/rest/v1/orders', { method }), /fetch failed/);
    assert.equal(calls, 1, method);
  }
});

test('응답이 안 오면 제한시간에 끊고 다시 시도한다', async () => {
  let calls = 0;
  const f = createRetryingFetch(
    (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        calls++;
        if (calls === 3) return resolve(ok());
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      }),
    { sleep, timeoutMs: 20 },
  );
  assert.equal((await f('https://x.test/slow')).status, 200);
  assert.equal(calls, 3);
});

test('호출한 쪽이 취소한 요청은 다시 시도하지 않는다', async () => {
  const controller = new AbortController();
  let calls = 0;
  const f = createRetryingFetch(async (_input, init) => {
    calls++;
    controller.abort(new DOMException('Aborted', 'AbortError'));
    if (init?.signal?.aborted) throw init.signal.reason;
    return ok();
  }, { sleep });
  await assert.rejects(() => f('https://x.test/a', { signal: controller.signal }));
  assert.equal(calls, 1);
});
