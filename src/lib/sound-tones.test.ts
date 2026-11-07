import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Web Audio를 흉내 낸 가짜. 하나의 컨텍스트만 만들어지므로(tones.ts가 재사용한다) 테스트마다 상태만 바꾼다.
const state = { oscillators: 0, resumeCalls: 0, resumeFails: false, contextState: 'suspended' as 'suspended' | 'running' };
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  get state() {
    return state.contextState;
  }
  addEventListener() {}
  async resume() {
    state.resumeCalls += 1;
    if (state.resumeFails) throw new Error('blocked');
    state.contextState = 'running';
  }
  createOscillator() {
    state.oscillators += 1;
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
  }
}
(globalThis as unknown as Record<string, unknown>).window = globalThis;
(globalThis as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a suspended audio context is resumed before the tone plays', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { playTone } = await import('./sound/tones.ts');
    state.contextState = 'suspended';
    state.oscillators = 0;
    const done = playTone('new-order', 0.8);
    await flush();
    mock.timers.tick(5000);
    await done;
    assert.equal(state.resumeCalls, 1);
    assert.ok(state.oscillators > 0, 'oscillators were scheduled after resuming');
  } finally {
    mock.timers.reset();
  }
});

test('a tone is skipped silently when the browser refuses to resume audio', async () => {
  const { playTone } = await import('./sound/tones.ts');
  state.contextState = 'suspended';
  state.resumeFails = true;
  state.oscillators = 0;
  await playTone('urgent', 0.8);
  assert.equal(state.oscillators, 0);
});
