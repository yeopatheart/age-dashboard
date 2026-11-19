// 필기 이력의 "시각 목록"과 "그 시각에 존재한 화면"(순수 함수). 한 번의 정기 점검은 같은 순간(captured_at)에 여러 화면의 스냅샷을 만들고,
// 급감(drop) 스냅샷은 화면 하나에 따로 생긴다. 그래서 분 단위로 묶어 한 "시각"으로 보여 주고, 고른 시각에는 그때까지 기록이 있던 화면만 고를 수 있게 한다.
import type { SnapshotInfo } from './history-queries.ts';
import { monitorRank } from './history-view.ts';

const MINUTE = 60_000;

export interface TimePoint {
  key: number; // 분 시작 시각(ms). 주소의 t 값
  endMs: number; // 그 분의 끝(ms). 이 시각까지의 기록이 "그 시각의 화면"이다
  monitors: string[]; // 이 분에 스냅샷이 만들어진 화면(1·2·s1·s2 순)
  drops: { monitor: string; prev: number | null; next: number | null }[]; // 이 분의 급감 감지
}

const capturedMs = (info: SnapshotInfo): number => Date.parse(info.capturedAt);
const sortMonitors = (monitors: Iterable<string>): string[] => [...new Set(monitors)].sort((a, b) => monitorRank(a) - monitorRank(b));

// 스냅샷 목록 → 시각 목록(최신순).
export function buildTimePoints(infos: readonly SnapshotInfo[]): TimePoint[] {
  const byMinute = new Map<number, SnapshotInfo[]>();
  for (const info of infos) {
    const ms = capturedMs(info);
    if (!Number.isFinite(ms)) continue;
    const key = Math.floor(ms / MINUTE) * MINUTE;
    byMinute.set(key, [...(byMinute.get(key) ?? []), info]);
  }
  return [...byMinute.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, list]) => ({
      key,
      endMs: key + MINUTE - 1,
      monitors: sortMonitors(list.map((i) => i.monitor)),
      drops: list.filter((i) => i.reason === 'drop').map((i) => ({ monitor: i.monitor, prev: i.prevPointCount, next: i.newPointCount })),
    }));
}

// endMs 시각까지 기록이 있던 화면(그 시각에 존재한 화면).
export function monitorsAt(infos: readonly SnapshotInfo[], endMs: number): string[] {
  return sortMonitors(infos.filter((i) => capturedMs(i) <= endMs).map((i) => i.monitor));
}

// endMs 시각의 그 화면 = 그때까지 가장 최근에 만들어진 스냅샷(같은 순간이면 id가 큰 것). 없으면 null.
export function snapshotAt(infos: readonly SnapshotInfo[], monitor: string, endMs: number): SnapshotInfo | null {
  let best: SnapshotInfo | null = null;
  for (const info of infos) {
    if (info.monitor !== monitor || !(capturedMs(info) <= endMs)) continue;
    if (best === null || capturedMs(info) > capturedMs(best) || (capturedMs(info) === capturedMs(best) && info.id > best.id)) best = info;
  }
  return best;
}
