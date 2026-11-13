// 되돌리기 기록(순수 함수). 한 단계 = 그 작업 직전의 그림 상태 + (포장 완료로 올렸다면) 그 상품 id.
// 되돌리면 그림은 직전 상태로 돌아가고, 포장 완료로 올렸던 작업이면 그 상품의 포장 완료도 취소한다(호출하는 쪽이 처리).
export const HISTORY_LIMIT = 30;

export interface HistoryEntry<S> {
  before: S;
  packedItemId?: string; // 이 작업으로 포장 완료로 올린 상품
}

export function pushHistory<S>(history: HistoryEntry<S>[], entry: HistoryEntry<S>, limit = HISTORY_LIMIT): HistoryEntry<S>[] {
  const next = [...history, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function popHistory<S>(history: HistoryEntry<S>[]): { entry: HistoryEntry<S> | null; rest: HistoryEntry<S>[] } {
  if (history.length === 0) return { entry: null, rest: history };
  return { entry: history[history.length - 1], rest: history.slice(0, -1) };
}
