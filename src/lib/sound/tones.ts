// 칠판 효과음: 파일 없이 Web Audio로 만든 짧은 톤. 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로(자동재생 제한)
// 칠판에서 "실시간 알림 켜기"를 한 번 눌러야 한다(unlockAudio). Chrome을 --autoplay-policy=no-user-gesture-required로 띄우면 누르지 않아도 된다.

export type ToneName = 'urgent' | 'cancel' | 'added' | 'changed' | 'new-order' | 'unshipped' | 'complete' | 'tick' | 'disconnected' | 'scan-ok' | 'scan-dup' | 'scan-fail' | 'test';

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
  // 이미 상차된 박스: 실패(낮은 한 번)와 구분되게 중간 높이의 짧은 두 번
  'scan-dup': { wave: 'sine', gain: 0.18, steps: [{ hz: 660, ms: 110 }, { hz: 0, ms: 70 }, { hz: 660, ms: 110 }] },
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

// 오디오가 돌고 있게 만든다. 막혀 있으면(suspended) resume을 시도하되 waitMs 안에 풀리지 않으면 포기하고 false를 돌려준다.
// 크롬은 사용자가 아직 한 번도 누르지 않은 페이지의 resume()을 reject하지 않고 클릭할 때까지 pending으로 둔다. 그냥 await하면
// 호출한 쪽(playCues의 재생 줄)이 영원히 멈춰서 그 뒤의 모든 알림이 소리 없이 쌓인다.
const RESUME_WAIT_MS = 400;
export async function ensureAudioRunning(waitMs = RESUME_WAIT_MS): Promise<boolean> {
  const c = getAudioContext();
  if (!c) return false;
  const running = () => c.state === 'running'; // 상태는 await 사이에 바뀐다(앞의 검사로 타입이 좁혀지지 않게 함수로 읽는다)
  if (running()) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([c.resume(), new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  } catch {
    // 막히면 running이 되지 않는다 — 호출한 쪽이 반환값으로 확인한다
  } finally {
    clearTimeout(timer);
  }
  return running();
}

// 사용자가 누르는 순간(클릭 핸들러 안)에 불러야 한다. 누른 직후라 resume이 곧 풀리므로 넉넉히 기다린다.
export const unlockAudio = () => ensureAudioRunning(1500);

export const isAudioRunning = () => ctx?.state === 'running';

export function subscribeAudioState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// 톤이 끝나면 풀리는 Promise를 돌려준다(음성을 톤 뒤에 이어 붙일 때 쓴다). 소리를 못 냈으면 false, 냈으면 true.
// 브라우저가 오디오를 멈춰 둔(suspended) 상태라면 잠깐(RESUME_WAIT_MS) 되살려 본다 — 이 페이지에서 사용자가 이미 한 번이라도 눌렀다면
// 크롬·사파리는 조작 없이도 resume을 허용한다. 되살리지 못하면(아직 한 번도 안 눌렀다면) 기다리지 않고 포기해서 호출한 쪽이 멈추지 않는다.
// 화면의 "소리가 꺼져 있습니다 — 눌러서 켜기" 안내가 그 상태를 알린다.
export async function playTone(name: ToneName, volume = 1): Promise<boolean> {
  if (!(await ensureAudioRunning())) return false;
  const c = getAudioContext();
  if (!c) return false;
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
  await new Promise<void>((resolve) => setTimeout(resolve, total * 1000 + 40));
  return true;
}
