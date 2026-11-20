// 화면 멈춤(메인 스레드가 오래 막힌 구간)을 구간 안에서 요약한다(순수 함수).
// 입력은 브라우저의 long-animation-frame(없으면 longtask) 기록이다. 기록 시각(startTime)은 페이지가 열린 시점(timeOrigin) 기준 ms.

export interface FreezeEntry {
  startTime: number;
  /** 그 프레임(또는 작업)이 걸린 시간. */
  duration: number;
  /** 화면을 막은 시간. long-animation-frame은 blockingDuration, longtask는 duration에서 50ms를 뺀 값. */
  blockingDuration: number;
}

/** [from, to) 안에서 시작한 기록 중 가장 긴 것(maxMs)과 막은 시간의 합계(blockedMs). 기록이 없으면 둘 다 0. */
export function summarizeFreezes(entries: readonly FreezeEntry[], from: number, to: number): { maxMs: number; blockedMs: number } {
  let maxMs = 0;
  let blockedMs = 0;
  for (const e of entries) {
    if (e.startTime < from || e.startTime >= to) continue;
    if (e.duration > maxMs) maxMs = e.duration;
    blockedMs += Math.max(0, e.blockingDuration);
  }
  return { maxMs: Math.round(maxMs), blockedMs: Math.round(blockedMs) };
}
