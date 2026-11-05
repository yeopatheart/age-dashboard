// 칠판 음성 안내: 브라우저 내장 음성(speechSynthesis)으로 한국어 문구를 읽는다. 파일도 서버도 필요 없다.
// 칠판의 OS·브라우저에 한국어 음성이 없으면 소리가 나지 않는다(koreanVoices가 빈 배열) — 현장에서 확인할 항목이다.
// 크롬은 음성 목록을 늦게 채우므로(voiceschanged) 목록은 부를 때마다 새로 읽는다.

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function koreanVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ko'));
}

// 사용자가 누르는 순간에 불러 음성 엔진을 깨운다(자동재생 제한). 들리지 않는 빈 소리를 한 번 낸다.
export function primeVoice(): void {
  if (!supported()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

// 읽기가 끝나면 풀리는 Promise. 음성을 못 내는 환경이거나 8초가 지나면(엔진이 멈추는 경우) 바로 풀린다.
export function speak(text: string, volume = 1): Promise<void> {
  if (!supported()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.volume = Math.max(0, Math.min(1, volume));
    u.rate = 1.05;
    const voice = koreanVoices()[0];
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
    setTimeout(resolve, 8000);
  });
}
