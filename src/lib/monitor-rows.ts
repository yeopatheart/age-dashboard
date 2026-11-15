// 주문 목록의 줄 높이와 한 모니터에 들어가는 줄 수(순수 함수). 예전부터 쓰던 규칙 그대로다 — 배포 순간 칠판의 줄 위치가 바뀌면
// 이미 써 둔 필기가 다른 줄에 얹히므로, 이 규칙은 바꾸지 않는다(2026-11-16). 달라진 것은 이 계산에 쓰는 높이(availHeight)가
// 기기 창이 아니라 기준 화면(board-stage.ts)의 높이라는 것뿐이다: 어느 기기에서 열어도 칠판과 같은 줄 수가 나온다.
//
// 행 높이는 고정값이 아니라 단계(큰 것부터)에서 고른다 — 모니터 2대에 주문이 전부 들어가는 가장 큰 높이를 쓰므로, 주문이 적으면 시원하게(40px),
// 많아지면 30px까지 줄어든다. 30px 미만은 가독성 때문에 내려가지 않는다.
// 칠판(본문 606px)에서의 모니터 1 줄 수: 주문 ≤30건 16줄(37px), 31~32건 17줄(35px), 33~36건 19줄(31px), 37~40건 20줄(30px).
import { fitRowHeight } from './row-fit.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export const ROW_HEIGHT_TIERS = [40, 36, 32, 30];
export const MIN_ROW_HEIGHT = ROW_HEIGHT_TIERS[ROW_HEIGHT_TIERS.length - 1];
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
  return fitRowHeight(availHeight, tier, MIN_ROW_HEIGHT, maxShrink);
}
