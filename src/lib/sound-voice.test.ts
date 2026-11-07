import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// 브라우저의 음성 엔진(speechSynthesis)을 흉내 낸 가짜. 호출 순서를 기록한다.
class FakeUtterance {
  text: string;
  lang = '';
  volume = 1;
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installSynth(initial: { speaking: boolean; pending: boolean }) {
  const calls: string[] = [];
  const utterances: FakeUtterance[] = [];
  const synth = {
    speaking: initial.speaking,
    pending: initial.pending,
    cancel() {
      calls.push('cancel');
      synth.speaking = false;
      synth.pending = false;
    },
    resume() {
      calls.push('resume');
    },
    speak(u: FakeUtterance) {
      calls.push('speak');
      utterances.push(u);
    },
    getVoices: () => [],
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { speechSynthesis: synth };
  g.SpeechSynthesisUtterance = FakeUtterance;
  return { synth, calls, utterances };
}

const options = { volume: 0.8, rate: 0.8, voiceName: '' };

test('a stale utterance left in the engine is cleared before speaking', async () => {
  const { calls, utterances } = installSynth({ speaking: true, pending: false });
  const { speak } = await import('./sound/voice.ts');
  const done = speak('새 주문입니다', options);
  assert.deepEqual(calls, ['cancel', 'resume', 'speak']);
  utterances[0].onend?.();
  await done;
});

test('an idle engine is not cancelled, only resumed', async () => {
  const { calls, utterances } = installSynth({ speaking: false, pending: false });
  const { speak } = await import('./sound/voice.ts');
  const done = speak('품목 추가', options);
  assert.deepEqual(calls, ['resume', 'speak']);
  utterances[0].onend?.();
  await done;
});

test('an utterance that never ends is cancelled after 8 seconds so later speech is not blocked', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { synth, calls } = installSynth({ speaking: false, pending: false });
    const { speak } = await import('./sound/voice.ts');
    const done = speak('멈추는 문장', options);
    synth.speaking = true; // 엔진이 말하는 중인 채로 멈춘 상태
    mock.timers.tick(8000);
    await done;
    assert.equal(calls.at(-1), 'cancel');
  } finally {
    mock.timers.reset();
  }
});

test('without speech support speak resolves immediately', async () => {
  (globalThis as unknown as Record<string, unknown>).window = {};
  const { speak } = await import('./sound/voice.ts');
  await speak('아무 소리도 안 나는 환경', options);
});
