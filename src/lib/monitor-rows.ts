// 주문 목록의 줄 높이와 한 모니터에 들어가는 줄 수(순수 함수).
//
// 2026-11-17 규칙 변경: 모니터 1이 담는 줄 수(capacity)를 주문 수와 무관하게 고정한다.
// 왜: 예전에는 주문 수에 따라 줄 높이 단계와 capacity가 바뀌었다(54→55건에서 28→31줄). 그러면 모니터 2의 앞쪽 줄 일부가 모니터 1로 넘어가는데,
// 필기는 모니터별 저장본(board_ink)에 있어서 그 줄에 쓴 필기가 따라가지 못했다(2026-11-17 장애). 경계가 움직이지 않으면 줄이 모니터를 옮기지 않는다.
// 예전의 "이 규칙은 바꾸지 않는다(2026-11-16)"는 배포 순간 줄 위치가 바뀌지 않게 하려던 것이었다. 주문 수에 따라 경계가 움직이는 구조 자체를 없애는
// 이 결정이 그것을 대체한다(docs/decisions/2026-11-17-fixed-monitor-capacity.md). 계산에 쓰는 높이(availHeight)는 기기 창이 아니라
// 기준 화면(board-stage.ts)의 높이라서 어느 기기에서 열어도 칠판과 같은 줄 수가 나온다.
//
// 규칙(availHeight > 0일 때):
//   주문 ≤74건    capacity 37 고정, 줄 높이 = floor(availHeight / 37) (위쪽 40px 제한)
//   주문 75~80건  capacity 40 고정, 줄 높이 = floor(availHeight / 40) (위쪽 40px 제한)
//   주문 >80건    예전 규칙 그대로(가장 촘촘한 단계). 두 모니터에 다 안 들어가는 줄은 hiddenRowCount가 센다.
//   고정 규칙의 줄 높이가 15px(MIN_ROW_HEIGHT) 미만이면(화면이 너무 낮음) 그 경우만 예전 규칙(단계 + fitRowHeight)으로 되돌아간다.
//
// 칠판(본문 606px)에서의 줄 수·높이:
//   주문   1~74건   모니터당 37줄 · 16px
//   주문  75~80건   모니터당 40줄 · 15px
//   주문 81건 이상  모니터당 40줄 · 15px (80건을 넘는 줄은 어느 모니터에도 안 보임)
// 줄 높이에 따른 글자(업체명 min(11, 줄높이−7) 등)는 dashboard-client의 dense 규칙(30px 미만)이 정한다.
import { fitRowHeight } from './row-fit.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export const ROW_HEIGHT_TIERS = [40, 36, 32, 30, 28, 26, 24, 22, 20, 18, 16, 15];
export const MIN_ROW_HEIGHT = ROW_HEIGHT_TIERS[ROW_HEIGHT_TIERS.length - 1];
const COMFORT_MIN_ROW_HEIGHT = 30; // 예전 규칙(폴백)에서 30px 이상 단계가 쓰는 하한
const MONITOR_COUNT = 2;
export const FIXED_CAPACITY = 37; // 주문이 FIXED_MAX_ROWS건 이하일 때 모니터 1이 담는 줄 수
export const FIXED_MAX_ROWS = MONITOR_COUNT * FIXED_CAPACITY; // 74
export const EXTENDED_CAPACITY = 40; // 주문이 FIXED_MAX_ROWS+1 ~ EXTENDED_MAX_ROWS건일 때 줄 수
export const EXTENDED_MAX_ROWS = MONITOR_COUNT * EXTENDED_CAPACITY; // 80

export interface RowLayout {
  rowHeight: number;
  capacity: number; // 한 모니터에 그리는 줄 칸 수(모니터 2는 이만큼 건너뛴 줄부터 시작한다)
}

// availHeight: 표 본문에 쓸 수 있는 높이(머리줄 제외). 0 이하면 아직 재지 못한 것이라 임시값을 쓴다
// (fallbackCapacity는 고정 줄 수와 같은 값을 넘겨 첫 렌더에서 경계가 흔들리지 않게 한다).
// fixedBoundary=false(전체 보기·휴대폰)는 모니터 경계가 없으므로 예전 규칙(주문 수에 맞춰 줄 높이를 고르는 계산)을 그대로 쓴다.
export function rowLayout(rowCount: number, availHeight: number, fallbackCapacity: number, maxShrink: number, fixedBoundary = true): RowLayout {
  if (!(availHeight > 0)) return { rowHeight: ROW_HEIGHT_TIERS[0], capacity: fallbackCapacity };
  const fixedCapacity = !fixedBoundary ? 0 : rowCount <= FIXED_MAX_ROWS ? FIXED_CAPACITY : rowCount <= EXTENDED_MAX_ROWS ? EXTENDED_CAPACITY : 0;
  if (fixedCapacity > 0) {
    const rowHeight = Math.min(ROW_HEIGHT_TIERS[0], Math.floor(availHeight / fixedCapacity));
    if (rowHeight >= MIN_ROW_HEIGHT) return { rowHeight, capacity: fixedCapacity };
  }
  return tierLayout(rowCount, availHeight, maxShrink);
}

// 예전 규칙: 모니터 2대에 주문이 전부 들어가는 가장 큰 높이 단계를 고른 뒤, 단계 높이로 나누고 남는 자투리가 하단의 어정쩡한 빈 공간이 되지 않게
// 행을 조금(maxShrink 이하) 줄여서 한 행을 더 넣을 수 있으면 넣는다(2026-11-14 현장 요청). 주문이 81건 이상이거나 화면이 너무 낮아
// 고정 규칙의 줄 높이가 15px 미만일 때만 쓴다.
function tierLayout(rowCount: number, availHeight: number, maxShrink: number): RowLayout {
  const tier = ROW_HEIGHT_TIERS.find((h) => MONITOR_COUNT * Math.floor(availHeight / h) >= rowCount) ?? MIN_ROW_HEIGHT;
  // 30px 이상 단계는 30px 하한으로, 그 아래 단계는 15px 하한으로 맞춘다.
  return fitRowHeight(availHeight, tier, tier >= COMFORT_MIN_ROW_HEIGHT ? COMFORT_MIN_ROW_HEIGHT : MIN_ROW_HEIGHT, maxShrink);
}

// 모니터 2에 가장 촘촘한 높이로도 다 못 들어가 어느 화면에도 안 나오는 줄 수. 모니터 1에서 모니터 2로 넘어간 줄은 안 보이는 것이 아니므로 모니터 2에서만 센다.
export function hiddenRowCount(mode: string, rowCount: number, capacity: number): number {
  return mode === '2' ? Math.max(0, rowCount - 2 * capacity) : 0;
}
