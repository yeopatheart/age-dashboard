// 칠판 효과음: 파일 없이 Web Audio로 만든 짧은 톤. 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로(자동재생 제한)
// 칠판에서 "칠판 모드 켜기"를 한 번 눌러야 한다(unlockAudio). Chrome을 --autoplay-policy=no-user-gesture-required로 띄우면 누르지 않아도 된다.

export type ToneName = 'urgent' | 'cancel' | 'added' | 'changed' | 'new-order' | 'unshipped' | 'complete' | 'tick' | 'disconnected' | 'scan-ok' | 'scan-fail' | 'test';

interface Step {
  hz: number; // 0이면 쉼
  ms: number;
}

// 소리 모양으로 뜻을 구분한다: 낮고 거친 연타 = 긴급, 내려가는 소리 = 취소, 올라가는 소리 = 추가.
const TONES: Record<ToneName, { wave: OscillatorType; gain: number; steps: Step[] }> = {
  urgent: { wave: 'square', gain: 0.18, steps: [{ hz: 330, ms: 150 }, { hz: 0, ms: 70 }, { hz: 330, ms: 150 }, { hz: 0, ms: 70 }, { hz: 330, ms: 150 }] },
  cancel: { wave: 'triangle', gain: 0.3, steps: [{ hz: 660, ms: 130 }, { hz: 440, ms: 220 }] },
  added: { wave: 'sine', gain: 0.3, steps: [{ hz: 784, ms: 170 }] },
  changed: { wave: 'sine', gain: 0.3, steps: [{ hz: 660, ms: 110 }, { hz: 0, ms: 50 }, { hz: 660, ms: 110 }] },
  'new-order': { wave: 'sine', gain: 0.3, steps: [{ hz: 587, ms: 120 }, { hz: 880, ms: 220 }] },
  unshipped: { wave: 'triangle', gain: 0.3, steps: [{ hz: 440, ms: 140 }, { hz: 0, ms: 40 }, { hz: 392, ms: 220 }] },
  complete: { wave: 'sine', gain: 0.3, steps: [{ hz: 784, ms: 100 }, { hz: 988, ms: 100 }, { hz: 1319, ms: 280 }] },
  tick: { wave: 'sine', gain: 0.2, steps: [{ hz: 1200, ms: 40 }] },
  disconnected: { wave: 'square', gain: 0.15, steps: [{ hz: 262, ms: 260 }, { hz: 0, ms: 80 }, { hz: 262, ms: 260 }, { hz: 0, ms: 80 }, { hz: 262, ms: 420 }] },
  'scan-ok': { wave: 'sine', gain: 0.15, steps: [{ hz: 880, ms: 120 }] },
  'scan-fail': { wave: 'sine', gain: 0.15, steps: [{ hz: 220, ms: 350 }] },
  test: { wave: 'sine', gain: 0.3, steps: [{ hz: 880, ms: 120 }] },
};

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    ctx.addEventListener('statechange', notify);
    queueMicrotask(notify); // 자동재생이 허용된 환경이면 만들자마자 running이다
  }
  return ctx;
}

// 사용자가 누르는 순간(클릭 핸들러 안)에 불러야 한다.
export async function unlockAudio(): Promise<boolean> {
  const c = getAudioContext();
  if (!c) return false;
  try {
    await c.resume();
  } catch {
    // 막히면 running이 되지 않는다 — 호출한 쪽이 isAudioRunning으로 확인한다
  }
  return c.state === 'running';
}

export const isAudioRunning = () => ctx?.state === 'running';

export function subscribeAudioState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// 톤이 끝나면 풀리는 Promise를 돌려준다(음성을 톤 뒤에 이어 붙일 때 쓴다). 소리를 못 내는 환경이면 바로 풀린다.
export function playTone(name: ToneName, volume = 1): Promise<void> {
  const c = getAudioContext();
  if (!c || c.state !== 'running') return Promise.resolve();
  const def = TONES[name];
  const peak = Math.max(0, Math.min(1, volume)) * def.gain;
  let t = c.currentTime + 0.02;
  for (const step of def.steps) {
    const dur = step.ms / 1000;
    if (step.hz > 0) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = def.wave;
      osc.frequency.value = step.hz;
      // 시작·끝을 부드럽게 올리고 내려서 "딱" 하는 잡음을 막는다
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.01);
      gain.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    t += dur;
  }
  const total = t - c.currentTime;
  return new Promise((resolve) => setTimeout(resolve, total * 1000 + 40));
}
