// 모니터 1·2의 행 높이 맞춤(순수 함수). 행 높이는 단계(40/36/32/30px)에서 고르는데, 단계 높이로 나누고 남는 자투리(예: 565px에서 14행 + 5px)가
// 하단의 어정쩡한 빈 공간이 된다. 그 자투리를 두고 보지 않고, 행을 조금(maxShrink 이하) 줄여서 한 행을 더 넣을 수 있으면 그렇게 한다
// (2026-11-14 사용자 요청). 줄인 높이가 가독성 하한(minHeight)보다 작아지거나 너무 많이 줄어야 하면 원래 단계를 그대로 쓴다.
export function fitRowHeight(availHeight: number, tierHeight: number, minHeight: number, maxShrink: number): { rowHeight: number; capacity: number } {
  const capacity = Math.max(1, Math.floor(availHeight / tierHeight));
  if (availHeight - capacity * tierHeight < 1) return { rowHeight: tierHeight, capacity }; // 딱 맞는다
  const next = capacity + 1;
  const rowHeight = Math.floor(availHeight / next);
  if (rowHeight >= minHeight && tierHeight - rowHeight <= maxShrink) return { rowHeight, capacity: next };
  return { rowHeight: tierHeight, capacity };
}
