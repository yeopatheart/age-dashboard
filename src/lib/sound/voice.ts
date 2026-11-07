// 칠판 음성 안내: 브라우저 내장 음성(speechSynthesis)으로 한국어 문구를 읽는다. 파일도 서버도 필요 없다.
// 칠판의 OS·브라우저에 한국어 음성이 없으면 소리가 나지 않는다(koreanVoices가 빈 배열) — 현장에서 확인할 항목이다.
// 크롬은 음성 목록을 늦게 채우므로(voiceschanged) 목록은 부를 때마다 새로 읽는다.

export interface VoiceOptions {
  volume: number; // 0 ~ 1
  rate: number; // 말하기 속도. 1이 보통, 작을수록 느리다
  voiceName: string; // 고른 음성 이름. 빈 글자면 자동 선택
}

export const MIN_RATE = 0.5;
export const MAX_RATE = 1.2;

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function koreanVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ko'));
}

// 고른 음성이 이 기기에 있으면 그것을, 아니면 또렷한 음성을 자동으로 고른다.
// 같은 한국어 음성이라도 신경망(Natural·Neural·Online) 음성이 발음이 가장 또렷하고, 그다음이 Google 음성이다.
export function pickVoice(voiceName: string): SpeechSynthesisVoice | undefined {
  const voices = koreanVoices();
  const chosen = voiceName ? voices.find((v) => v.name === voiceName) : undefined;
  if (chosen) return chosen;
  const rank = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2);
  return [...voices].sort((a, b) => rank(a) - rank(b))[0];
}

// 사용자가 누르는 순간에 불러 음성 엔진을 깨운다(자동재생 제한). 들리지 않는 빈 소리를 한 번 낸다.
export function primeVoice(): void {
  if (!supported()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

// 읽기가 끝나면 풀리는 Promise. 음성을 못 내는 환경이거나 8초가 지나면(엔진이 멈추는 경우) 바로 풀린다.
// 크롬은 오래 켜 둔 페이지에서 음성 엔진이 멈추는 알려진 문제가 있다: 멈춘 발화가 대기열 맨 앞에 남아서 그 뒤의 모든 읽기가
// 영원히 소리 없이 쌓인다(처음엔 나다가 갑자기 안 나는 증상). 그래서 재생은 playCues가 한 번에 하나씩만 시키므로, 읽기를 시작할 때
// 아직 "말하는 중/대기 중"이면 멈춘 잔여물로 보고 비운 뒤(cancel) 다시 깨워서(resume) 시작하고, 8초가 지나도 안 끝나면 같은 방식으로 비운다.
export function speak(text: string, options: VoiceOptions): Promise<void> {
  if (!supported()) return Promise.resolve();
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
  synth.resume();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.volume = Math.max(0, Math.min(1, options.volume));
    u.rate = Math.max(MIN_RATE, Math.min(MAX_RATE, options.rate));
    u.pitch = 1;
    const voice = pickVoice(options.voiceName);
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
    setTimeout(() => {
      // 8초가 지나도 안 끝났으면 엔진이 멈춘 것이다. 멈춘 발화를 비워 다음 읽기가 막히지 않게 한다.
      if (synth.speaking || synth.pending) synth.cancel();
      resolve();
    }, 8000);
  });
}
