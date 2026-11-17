// 주문 목록의 줄 높이와 한 모니터에 들어가는 줄 수(순수 함수).
//
// 2026-11-17 규칙 변경: 모니터 1이 담는 줄 수(capacity)를 주문 수와 무관하게 고정한다.
// 왜: 예전에는 주문 수에 따라 줄 높이 단계와 capacity가 바뀌었다(54→55건에서 28→31줄). 그러면 모니터 2의 앞쪽 줄 일부가 모니터 1로 넘어가는데,
// 필기는 모니터별 저장본(board_ink)에 있어서 그 줄에 쓴 필기가 따라가지 못했다(2026-11-17 장애). 경계가 움직이지 않으면 줄이 모니터를 옮기지 않는다.
// 예전의 "이 규칙은 바꾸지 않는다(2026-11-16)"는 배포 순간 줄 위치가 바뀌지 않게 하려던 것이었다. 주문 수에 따라 경계가 움직이는 구조 자체를 없애는
// 이 결정이 그것을 대체한다(docs/decisions/2026-11-17-fixed-monitor-capacity.md). 계산에 쓰는 높이(availHeight)는 기기 창이 아니라
// 기준 화면(board-stage.ts)의 높이라서 어느 기기에서 열어도 칠판과 같은 줄 수가 나온다.
//
// 규칙(availHeight > 0일 때, 모니터 1·2 보기):
//   주문 ≤70건   두 모니터 모두 capacity 35 고정, 줄 높이 = floor(availHeight / 35) (위쪽 40px 제한). 모니터 2는 36번째 줄부터 시작한다.
//   주문 ≥71건   모니터 1은 그대로(35줄, 같은 줄 높이, 1~35번). 모니터 2는 36번째부터 나머지 전부(n = 주문 수 − 35줄)를 담도록 줄 높이만 줄인다:
//                줄 높이 = max(15, floor(availHeight / n)), 줄 칸 수 = floor(availHeight / 줄 높이). n이 floor(availHeight / 15)를 넘으면
//                넘는 주문만 안 보이고 hiddenRowCount가 센다.
//   모니터 1의 경계(모니터 2가 36번째에서 시작)는 어떤 주문 수에서도 움직이지 않는다 — 줄이 모니터를 넘어가면 필기가 따라가지 못해서다(핵심 불변식).
//   화면이 너무 낮아 35줄이 15px 미만이면(availHeight < 525) 예전 규칙(단계 + fitRowHeight)으로 되돌아간다. 그 경우 두 모니터는 같은 높이·줄 수다.
// 2026-11-17 후속: 37줄 배포 뒤 현장이 상단·표 머리를 줄여 줄 영역을 키우고 35줄로 줄이길 원했다(줄이 높아져 글자가 커진다).
// 71건 이상은 사용자가 "70건을 넘을 일은 없다"고 봐서 안전하게 동작하는 최소 구현만 둔다(docs/decisions/2026-11-17-monitor-35-rows.md).
//
// 줄 수·높이(본문 높이 availHeight는 상단·표 머리 높이에 따라 달라진다. 아래는 두 가정):
//   주문          본문 606px                                     본문 634px(상단·머리를 줄인 뒤, 추정)
//   1~70건        두 모니터 35줄 · 17px                           두 모니터 35줄 · 18px
//   71~75건       모니터 1: 35줄 · 17px / 모니터 2: n줄, 16→15px    (71~77건) 모니터 1: 35줄 · 18px / 모니터 2: n줄, 17→15px
//   76건 이상     모니터 2는 40줄 · 15px, 넘는 주문은 안 보임        (78건 이상) 모니터 2는 42줄 · 15px, 넘는 주문은 안 보임
// 줄 높이에 따른 글자(업체명 min(11, 줄높이−7) 등)는 dashboard-client의 dense 규칙(30px 미만)이 정한다.
import { fitRowHeight } from './row-fit.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export const ROW_HEIGHT_TIERS = [40, 36, 32, 30, 28, 26, 24, 22, 20, 18, 16, 15];
export const MIN_ROW_HEIGHT = ROW_HEIGHT_TIERS[ROW_HEIGHT_TIERS.length - 1];
const COMFORT_MIN_ROW_HEIGHT = 30; // 예전 규칙(폴백)에서 30px 이상 단계가 쓰는 하한
const MONITOR_COUNT = 2;
export const FIXED_CAPACITY = 35; // 주문이 FIXED_MAX_ROWS건 이하일 때 모니터 1이 담는 줄 수
export const FIXED_MAX_ROWS = MONITOR_COUNT * FIXED_CAPACITY; // 70

export interface RowLayout {
  rowHeight: number;
  capacity: number; // 이 모니터에 그리는 줄 칸 수
  monitor2Start: number; // 모니터 2가 시작하는 0-기준 줄 위치 = 모니터 1이 담는 줄 수
}

// availHeight: 표 본문에 쓸 수 있는 높이(머리줄 제외). 0 이하면 아직 재지 못한 것이라 임시값을 쓴다
// (fallbackCapacity는 고정 줄 수와 같은 값을 넘겨 첫 렌더에서 경계가 흔들리지 않게 한다).
// fixedBoundary=false(전체 보기·휴대폰)는 모니터 경계가 없으므로 예전 규칙(주문 수에 맞춰 줄 높이를 고르는 계산)을 그대로 쓴다.
// monitor: 어느 모니터의 값을 구하는지('2'만 71건 이상에서 모니터 1과 다르다. 모니터 1·그 외는 같은 값).
export function rowLayout(rowCount: number, availHeight: number, fallbackCapacity: number, maxShrink: number, fixedBoundary = true, monitor = '1'): RowLayout {
  if (!(availHeight > 0)) return { rowHeight: ROW_HEIGHT_TIERS[0], capacity: fallbackCapacity, monitor2Start: fallbackCapacity };
  if (fixedBoundary) {
    const rowHeight = Math.min(ROW_HEIGHT_TIERS[0], Math.floor(availHeight / FIXED_CAPACITY));
    if (rowHeight >= MIN_ROW_HEIGHT) {
      const monitor2Rows = rowCount - FIXED_CAPACITY;
      if (monitor !== '2' || monitor2Rows <= FIXED_CAPACITY) return { rowHeight, capacity: FIXED_CAPACITY, monitor2Start: FIXED_CAPACITY };
      // 71건 이상의 모니터 2: 줄 높이만 줄여 남은 주문을 담는다. 15px로도 못 담으면 넘는 주문만 안 보인다.
      const height2 = Math.min(rowHeight, Math.max(MIN_ROW_HEIGHT, Math.floor(availHeight / monitor2Rows))); // 아주 높은 화면에서 모니터 1보다 높아지거나 40px를 넘지 않게
      return { rowHeight: height2, capacity: Math.floor(availHeight / height2), monitor2Start: FIXED_CAPACITY };
    }
  }
  return tierLayout(rowCount, availHeight, maxShrink);
}

// 예전 규칙: 모니터 2대에 주문이 전부 들어가는 가장 큰 높이 단계를 고른 뒤, 단계 높이로 나누고 남는 자투리가 하단의 어정쩡한 빈 공간이 되지 않게
// 행을 조금(maxShrink 이하) 줄여서 한 행을 더 넣을 수 있으면 넣는다(2026-11-14 현장 요청). 화면이 너무 낮아 고정 규칙을 못 쓸 때
// (35줄이 15px 미만)와 전체 보기·휴대폰에서만 쓴다.
function tierLayout(rowCount: number, availHeight: number, maxShrink: number): RowLayout {
  const tier = ROW_HEIGHT_TIERS.find((h) => MONITOR_COUNT * Math.floor(availHeight / h) >= rowCount) ?? MIN_ROW_HEIGHT;
  // 30px 이상 단계는 30px 하한으로, 그 아래 단계는 15px 하한으로 맞춘다.
  const { rowHeight, capacity } = fitRowHeight(availHeight, tier, tier >= COMFORT_MIN_ROW_HEIGHT ? COMFORT_MIN_ROW_HEIGHT : MIN_ROW_HEIGHT, maxShrink);
  return { rowHeight, capacity, monitor2Start: capacity };
}

// 모니터 2에 가장 촘촘한 높이로도 다 못 들어가 어느 화면에도 안 나오는 줄 수(모니터 2가 monitor2Start번째부터 capacity줄을 담는다).
// 모니터 1에서 모니터 2로 넘어간 줄은 안 보이는 것이 아니므로 모니터 2에서만 센다.
export function hiddenRowCount(mode: string, rowCount: number, monitor2Start: number, capacity: number): number {
  return mode === '2' ? Math.max(0, rowCount - monitor2Start - capacity) : 0;
}
