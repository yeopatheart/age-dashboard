// 되돌리기 기록(순수 함수). 한 단계 = 그 작업 직전의 그림 상태 + 그 작업이 바꾼 포장 상태.
// 되돌리면 그림은 직전 상태로 돌아가고, 그 작업이 포장 완료로 올렸던 상품은 해제하고, 포장 해제했던 상품은 다시 포장 완료로 올린다(호출하는 쪽이 처리).
export const HISTORY_LIMIT = 30;

export interface HistoryEntry<S> {
  before: S;
  packed?: string[]; // 이 작업(동그라미·직선)으로 포장 완료로 올린 상품 id
  unpacked?: string[]; // 이 작업(지우개)으로 포장 해제한 상품 id
}

export function pushHistory<S>(history: HistoryEntry<S>[], entry: HistoryEntry<S>, limit = HISTORY_LIMIT): HistoryEntry<S>[] {
  const next = [...history, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function popHistory<S>(history: HistoryEntry<S>[]): { entry: HistoryEntry<S> | null; rest: HistoryEntry<S>[] } {
  if (history.length === 0) return { entry: null, rest: history };
  return { entry: history[history.length - 1], rest: history.slice(0, -1) };
}
