import type { Cue } from './order-events';
import { playTone } from './tones';
import { speak } from './voice';

// 소리가 겹치지 않게 순서대로 재생한다: 큐마다 톤 → (음성 모드면) 문구.
let chain: Promise<void> = Promise.resolve();

export function playCues(cues: Cue[], mode: 'voice' | 'tone', volume: number): Promise<void> {
  chain = chain
    .then(async () => {
      for (const cue of cues) {
        await playTone(cue.tone, volume);
        if (mode === 'voice' && cue.say) await speak(cue.say, volume);
      }
    })
    .catch(() => {
      // 소리 재생 실패가 화면 동작을 막으면 안 된다
    });
  return chain;
}
