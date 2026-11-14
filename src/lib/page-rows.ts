// 별도 주문 팝업처럼 행 높이가 제각각인 목록을 스크롤 없이 보여 주려고, 주어진 높이(avail)에 들어가는 만큼씩 화면(쪽)으로 나눈다.
// 주문 목록의 모니터 1·2와 같은 발상이다. heights는 행마다 잰 높이(px), gap은 행 사이 간격. 돌려주는 값은 쪽마다 행의 번호(0부터) 목록이다.
// 한 행이 혼자서도 avail보다 크면 그 행이 한 쪽을 혼자 쓴다. avail이 0 이하(아직 모름)면 모든 행을 한 쪽에 둔다.
export function packRows(heights: number[], avail: number, gap = 0): number[][] {
  if (heights.length === 0) return [[]];
  if (!(avail > 0)) return [heights.map((_, i) => i)];
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    const next = current.length === 0 ? h : used + gap + h;
    if (current.length > 0 && next > avail) {
      pages.push(current);
      current = [i];
      used = h;
    } else {
      current.push(i);
      used = next;
    }
  });
  pages.push(current);
  return pages;
}
