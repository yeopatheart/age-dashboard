// 주문 목록 "강조할 상품"의 색(2026-11-27, 결정: docs/decisions/2026-11-27-highlight-colors.md). 상품명의 글자색만 바꾼다
// (색 바탕은 칩과 헷갈려 채택하지 않았다). 칩 바탕에서 읽히는 진한 색 가운데, 서로 그리고 "추가됨(초록)·수정됨(노랑)" 칸의 일반 상품명 글자색과
// 되도록 먼 색을 골라 앞에서부터 더 확실히 구분되게 놓았다. 색을 바꾸면 highlight-colors.test.ts가 서로의 차이와 대비를 확인한다.
// 그날 강조한 상품 하나(daily_product_highlights 한 줄).
export interface DailyHighlight {
  name: string;
  position: number;
}

export const HIGHLIGHT_COLORS = [
  '#dc2626', // 빨강
  '#1d4ed8', // 파랑
  '#6d7411', // 올리브
  '#502c0b', // 갈색
  '#d6009d', // 자홍
  '#23768b', // 물빛 청색
];

// 저장된 position이 곧 색 자리다(daily_product_highlights.position). 목록에서 몇 번째인지로 정하지 않으므로,
// 다른 상품을 해제해도 남은 상품의 색은 바뀌지 않는다.
export function highlightColorOf(position: number): string {
  const n = HIGHLIGHT_COLORS.length;
  return HIGHLIGHT_COLORS[((position % n) + n) % n];
}

// 새로 강조하는 상품의 position: 지금 가장 적게 쓰는 색 자리(같으면 앞쪽 색)를 고르고, 그 색 자리에 해당하는 아직 안 쓴 번호를 준다.
// 그래서 빈 색이 있으면 반드시 빈 색을 받고, 6개를 넘으면 앞 색부터 한 번씩 더 쓴다. 서버 저장과 화면의 즉시 반영이 같은 값을 쓴다.
export function nextHighlightPosition(used: number[]): number {
  const n = HIGHLIGHT_COLORS.length;
  const count = Array<number>(n).fill(0);
  for (const p of used) count[((p % n) + n) % n] += 1;
  const slot = count.indexOf(Math.min(...count));
  const taken = new Set(used);
  let position = slot;
  while (taken.has(position)) position += n;
  return position;
}
