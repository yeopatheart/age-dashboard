// 필기 이력의 "시각 목록"과 "그 시각에 존재한 화면"(순수 함수). 한 번의 정기 점검은 같은 순간(captured_at)에 여러 화면의 스냅샷을 만들고,
// 급감(drop) 스냅샷은 화면 하나에 따로 생긴다. 그래서 분 단위로 묶어 한 "시각"으로 보여 준다.
// 화면은 두 묶음으로 본다: 버스 주문(모니터 1·2)과 별도 주문(별도 1·2). 한 묶음의 두 화면은 한 표에 필기를 합쳐 보여 준다.
import type { SnapshotInfo } from './history-queries.ts';
import { groupOfMonitor, monitorRank, type BoardGroup } from './history-view.ts';

const MINUTE = 60_000;
const GROUP_ORDER: readonly BoardGroup[] = ['bus', 'sep'];

export interface TimePoint {
  key: number; // 분 시작 시각(ms). 주소의 t 값
  endMs: number; // 그 분의 끝(ms). 이 시각까지의 기록이 "그 시각의 화면"이다
  groups: BoardGroup[]; // 이 분에 스냅샷이 만들어진 묶음(버스·별도 순)
  dropGroups: BoardGroup[]; // 이 분에 급감 감지가 있었던 묶음
}

const capturedMs = (info: SnapshotInfo): number => Date.parse(info.capturedAt);
const sortGroups = (groups: Iterable<BoardGroup>): BoardGroup[] => GROUP_ORDER.filter((g) => new Set(groups).has(g));

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
      groups: sortGroups(list.map((i) => groupOfMonitor(i.monitor))),
      dropGroups: sortGroups(list.filter((i) => i.reason === 'drop').map((i) => groupOfMonitor(i.monitor))),
    }));
}

// endMs 시각까지 기록이 있던 묶음(그 시각에 존재한 화면).
export function groupsAt(infos: readonly SnapshotInfo[], endMs: number): BoardGroup[] {
  return sortGroups(infos.filter((i) => capturedMs(i) <= endMs).map((i) => groupOfMonitor(i.monitor)));
}

// 한 묶음의 endMs 시각 화면들 = 묶음 안 각 모니터의 그때까지 가장 최근 스냅샷(모니터 1·2 순). 기록이 없는 모니터는 빠진다.
export function groupSnapshotsAt(infos: readonly SnapshotInfo[], group: BoardGroup, endMs: number): SnapshotInfo[] {
  const monitors = [...new Set(infos.filter((i) => groupOfMonitor(i.monitor) === group).map((i) => i.monitor))].sort((a, b) => monitorRank(a) - monitorRank(b));
  return monitors.flatMap((m) => {
    const info = snapshotAt(infos, m, endMs);
    return info ? [info] : [];
  });
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
