import test from 'node:test';
import assert from 'node:assert/strict';

// 크롬처럼 막힌 오디오를 흉내 낸 가짜: 사용자가 누르기 전의 resume()은 reject되지 않고 영원히 pending이다.
// (sound-tones.test.ts의 가짜는 resume이 reject되는 경우만 다뤄서 이 경우를 잡지 못했다.)
const state = { oscillators: 0, resumeCalls: 0, spoken: [] as string[], contextState: 'suspended' as 'suspended' | 'running', pending: [] as Array<() => void> };
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  get state() {
    return state.contextState;
  }
  addEventListener() {}
  resume() {
    state.resumeCalls += 1;
    if (state.contextState === 'running') return Promise.resolve();
    return new Promise<void>((resolve) => state.pending.push(resolve));
  }
  createOscillator() {
    state.oscillators += 1;
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
  }
}
class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  voice: unknown;
  lang = '';
  volume = 1;
  rate = 1;
  pitch = 1;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}
const fakeSynth = {
  speaking: false,
  pending: false,
  cancel() {},
  resume() {},
  getVoices: () => [],
  speak(u: FakeUtterance) {
    state.spoken.push(u.text);
    queueMicrotask(() => u.onend?.());
  },
};
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.AudioContext = FakeAudioContext;
g.speechSynthesis = fakeSynth;
g.SpeechSynthesisUtterance = FakeUtterance;

// 사용자가 화면을 누른 것처럼 막힌 오디오를 푼다.
const userClick = () => {
  state.contextState = 'running';
  state.pending.splice(0).forEach((resolve) => resolve());
};
const reset = () => {
  state.oscillators = 0;
  state.resumeCalls = 0;
  state.spoken = [];
  state.pending = [];
  state.contextState = 'suspended';
};

const settings = { mode: 'voice' as const, volume: 0.8, rate: 1, voiceName: '' };
const cue = { tone: 'changed' as const, say: ['수량 변경. 업체A. 활전갱이'] };

test('blocked audio drops the alert instead of hanging, voice included', async () => {
  const { playCues } = await import('./sound/player.ts');
  reset();
  const played = await playCues([cue], settings); // 예전에는 여기서 영원히 멈췄다
  assert.equal(played, false);
  assert.equal(state.oscillators, 0);
  assert.deepEqual(state.spoken, []);
});

test('alerts after a blocked one are not stuck behind it', async () => {
  const { playCues } = await import('./sound/player.ts');
  reset();
  const results = await Promise.all([playCues([cue], settings), playCues([cue], settings), playCues([cue], settings)]);
  assert.deepEqual(results, [false, false, false]);
});

test('dropped alerts are not replayed in a burst once the user unlocks audio', async () => {
  const { playCues } = await import('./sound/player.ts');
  reset();
  await playCues([cue], settings);
  await playCues([cue], settings);
  userClick();
  assert.equal(state.oscillators, 0, 'nothing plays by itself after the click');
  assert.deepEqual(state.spoken, []);
});

test('after the user unlocks audio, new alerts play tone then voice', async () => {
  const { playCues } = await import('./sound/player.ts');
  reset();
  await playCues([cue], settings);
  userClick();
  const played = await playCues([cue], settings);
  assert.equal(played, true);
  assert.ok(state.oscillators > 0);
  assert.deepEqual(state.spoken, ['수량 변경. 업체A. 활전갱이']);
});
