// 주문 목록의 줄 높이와 한 모니터에 들어가는 줄 수(순수 함수). 예전부터 쓰던 규칙 그대로다 — 배포 순간 칠판의 줄 위치가 바뀌면
// 이미 써 둔 필기가 다른 줄에 얹히므로, 이 규칙은 바꾸지 않는다(2026-11-16). 달라진 것은 이 계산에 쓰는 높이(availHeight)가
// 기기 창이 아니라 기준 화면(board-stage.ts)의 높이라는 것뿐이다: 어느 기기에서 열어도 칠판과 같은 줄 수가 나온다.
//
// 행 높이는 고정값이 아니라 단계(큰 것부터)에서 고른다 — 모니터 2대에 주문이 전부 들어가는 가장 큰 높이를 쓰므로, 주문이 적으면 시원하게(40px),
// 많아지면 줄어든다. 주문이 40건 이하면 30px 이상(예전 규칙 그대로)이고, 40건을 넘으면 30px 미만 단계(28→15px)로 내려가 80건까지 두 모니터에 다 넣는다
// (2026-11-17: 51건 중 11건이 안 보이는 장애. 30px 미만에서는 칸 여백·테두리도 줄이고 칩 글자는 칩 높이에 맞춰 자동으로 줄어든다 — dashboard-client의 dense). 15px 미만은 글자가 들어가지 않아 내려가지 않는다.
// 칠판(본문 606px)에서의 모니터 1 줄 수: 주문 ≤30건 16줄(37px), 31~32건 17줄(35px), 33~36건 19줄(31px), 37~40건 20줄(30px), 41~80건 21~40줄(27→15px).
import { fitRowHeight } from './row-fit.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export const ROW_HEIGHT_TIERS = [40, 36, 32, 30, 28, 26, 24, 22, 20, 18, 16, 15];
export const MIN_ROW_HEIGHT = ROW_HEIGHT_TIERS[ROW_HEIGHT_TIERS.length - 1];
const COMFORT_MIN_ROW_HEIGHT = 30; // 주문이 이 높이 이상으로 들어갈 때의 하한(예전 규칙). 이 안에서는 배포 전과 줄 위치가 완전히 같다.
const MONITOR_COUNT = 2;

export interface RowLayout {
  rowHeight: number;
  capacity: number; // 한 모니터에 그리는 줄 칸 수(모니터 2는 이만큼 건너뛴 줄부터 시작한다)
}

// availHeight: 표 본문에 쓸 수 있는 높이(머리줄 제외). 0이면 아직 재지 못한 것이라 임시값을 쓴다.
// 단계 높이로 나누고 남는 자투리가 하단의 어정쩡한 빈 공간이 되지 않게, 행을 조금(maxShrink 이하) 줄여서 한 행을 더 넣을 수 있으면 넣는다(2026-11-14 현장 요청).
export function rowLayout(rowCount: number, availHeight: number, fallbackCapacity: number, maxShrink: number): RowLayout {
  if (!(availHeight > 0)) return { rowHeight: ROW_HEIGHT_TIERS[0], capacity: fallbackCapacity };
  const tier = ROW_HEIGHT_TIERS.find((h) => MONITOR_COUNT * Math.floor(availHeight / h) >= rowCount) ?? MIN_ROW_HEIGHT;
  // 30px 이상 단계는 예전과 같은 하한(30px)으로 맞춘다 — 하한을 낮추면 주문 37~40건에서도 줄 수가 달라져 이미 쓴 필기의 줄 위치가 바뀐다.
  return fitRowHeight(availHeight, tier, tier >= COMFORT_MIN_ROW_HEIGHT ? COMFORT_MIN_ROW_HEIGHT : MIN_ROW_HEIGHT, maxShrink);
}

// 모니터 2에 가장 촘촘한 높이로도 다 못 들어가 어느 화면에도 안 나오는 줄 수. 모니터 1에서 모니터 2로 넘어간 줄은 안 보이는 것이 아니므로 모니터 2에서만 센다.
export function hiddenRowCount(mode: string, rowCount: number, capacity: number): number {
  return mode === '2' ? Math.max(0, rowCount - 2 * capacity) : 0;
}
