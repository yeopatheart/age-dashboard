import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitFailureMessage, deleteCreatedCards, firstResultError, isFrameworkSignal, runInChunks } from './commit-failure.ts';

test('새로 만든 카드가 없으면 아무것도 지우지 않는다', async () => {
  let called = false;
  const result = await deleteCreatedCards([], async () => {
    called = true;
    return { error: null };
  });
  assert.equal(called, false);
  assert.deepEqual(result, { attempted: 0, error: null });
});

test('새로 만든 카드 id를 모두 지운다', async () => {
  let received: string[] = [];
  const result = await deleteCreatedCards(['a', 'b'], async (ids) => {
    received = ids;
    return { error: null };
  });
  assert.deepEqual(received, ['a', 'b']);
  assert.deepEqual(result, { attempted: 2, error: null });
});

test('삭제가 실패해도 던지지 않고 이유를 돌려준다(원래 오류를 가리지 않는다)', async () => {
  const dbError = await deleteCreatedCards(['a'], async () => ({ error: { message: 'permission denied' } }));
  assert.deepEqual(dbError, { attempted: 1, error: 'permission denied' });
  const thrown = await deleteCreatedCards(['a'], async () => {
    throw new Error('network down');
  });
  assert.deepEqual(thrown, { attempted: 1, error: 'network down' });
});

test('Next.js의 redirect 신호는 화면 문구로 바꾸지 않는다', () => {
  assert.equal(isFrameworkSignal(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })), true);
  assert.equal(isFrameworkSignal(new Error('상품 저장 실패')), false);
  assert.equal(isFrameworkSignal(null), false);
});

test('실패 문구는 원인을 그대로 보여 주고, 정리 실패는 따로 알린다', () => {
  const ok = commitFailureMessage(new Error('상품 저장 실패: x'), { attempted: 2, error: null });
  assert.match(ok, /^상품 저장 실패: x — 저장하지 않았습니다\.$/);
  const bad = commitFailureMessage(new Error('상품 저장 실패: x'), { attempted: 2, error: 'denied' });
  assert.match(bad, /정리하지 못했습니다/);
  assert.match(bad, /2개/);
  assert.match(commitFailureMessage('이상한 값', { attempted: 0, error: null }), /알 수 없는 오류/);
});

test('상품 줄이 저장된 뒤의 실패는 "저장하지 않았습니다"라고 하지 않고 다시 확정하지 말라고 안내한다', () => {
  const message = commitFailureMessage(new Error('주문 반영 중 일부 저장 실패: x'), { attempted: 0, error: null }, true);
  assert.doesNotMatch(message, /저장하지 않았습니다/);
  assert.match(message, /다시 확정하지 말고/);
});

test('runInChunks는 묶음 크기만큼만 동시에 실행하고 결과 순서를 지킨다', async () => {
  let running = 0;
  let peak = 0;
  const tasks = Array.from({ length: 25 }, (_, i) => async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 2));
    running--;
    return i;
  });
  const out = await runInChunks(tasks, 10);
  assert.deepEqual(out, Array.from({ length: 25 }, (_, i) => i));
  assert.equal(peak, 10);
  assert.deepEqual(await runInChunks([], 10), []);
});

test('firstResultError는 첫 오류 문구만 돌려준다', () => {
  assert.equal(firstResultError([{ error: null }, undefined, { error: { message: 'a' } }, { error: { message: 'b' } }]), 'a');
  assert.equal(firstResultError([{ error: null }, null]), null);
});
