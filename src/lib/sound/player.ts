import type { Cue } from './order-events.ts';
import type { SoundSettings } from './settings.ts';
import { playTone } from './tones.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 확장자 없는 import를 못 푼다
import { speak } from './voice.ts';

const GAP_MS = 250; // 구절 사이의 짧은 쉼(이어 읽으면 뭉개져서 알아듣기 어렵다)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type PlaySettings = Pick<SoundSettings, 'mode' | 'volume' | 'rate' | 'voiceName'>;

// 소리가 겹치지 않게 순서대로 재생한다: 큐마다 톤 → (음성 모드면) 구절을 하나씩 천천히, 구절 사이에 쉼.
let chain: Promise<void> = Promise.resolve();

// 브라우저가 오디오를 막고 있어 톤을 못 냈으면 그 알림은 버린다(음성도 같은 사용자 조작이 필요해서 함께 버린다).
// 쌓아 두면 나중에 "눌러서 켜기"를 누르는 순간 묵은 알림이 한꺼번에 터진다. 버린 알림은 화면의 변경 목록과 "놓친 변경"으로 알린다.
async function play(cues: Cue[], s: PlaySettings): Promise<boolean> {
  for (const cue of cues) {
    if (!(await playTone(cue.tone, s.volume))) return false;
    if (s.mode !== 'voice' || !cue.say) continue;
    for (const line of cue.say) {
      await speak(line, s);
      await sleep(GAP_MS);
    }
  }
  return true;
}

// 끝까지 재생했으면 true, 소리를 못 내서 버렸거나 재생이 실패했으면 false.
export function playCues(cues: Cue[], s: PlaySettings): Promise<boolean> {
  const result = chain.then(() => play(cues, s));
  chain = result.then(
    () => undefined,
    () => undefined, // 소리 재생 실패가 뒤의 알림을 막으면 안 된다
  );
  return result.catch(() => false);
}
