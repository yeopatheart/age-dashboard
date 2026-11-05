import type { Cue } from './order-events';
import type { SoundSettings } from './settings';
import { playTone } from './tones';
import { speak } from './voice';

const GAP_MS = 250; // 구절 사이의 짧은 쉼(이어 읽으면 뭉개져서 알아듣기 어렵다)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 소리가 겹치지 않게 순서대로 재생한다: 큐마다 톤 → (음성 모드면) 구절을 하나씩 천천히, 구절 사이에 쉼.
let chain: Promise<void> = Promise.resolve();

export function playCues(cues: Cue[], s: Pick<SoundSettings, 'mode' | 'volume' | 'rate' | 'voiceName'>): Promise<void> {
  chain = chain
    .then(async () => {
      for (const cue of cues) {
        await playTone(cue.tone, s.volume);
        if (s.mode !== 'voice' || !cue.say) continue;
        for (const line of cue.say) {
          await speak(line, s);
          await sleep(GAP_MS);
        }
      }
    })
    .catch(() => {
      // 소리 재생 실패가 화면 동작을 막으면 안 된다
    });
  return chain;
}
