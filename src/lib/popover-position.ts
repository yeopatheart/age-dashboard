// 칩을 눌렀을 때 그 옆에 뜨는 플로팅 카드의 위치(순수 함수).
// 칩이 화면 오른쪽에 있으면(품목별 수량 패널) 칩의 왼쪽에, 그렇지 않으면(전체보기 위쪽 카드 등) 칩의 아래에 두고 자리가 없으면 위에 둔다.
// 화면 밖으로 나가지 않게 가둔다.
export interface Rect4 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export function placePopover(anchor: Rect4, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 8): { left: number; top: number; side: 'left' | 'below' | 'above' } {
  const centerX = (anchor.left + anchor.right) / 2;
  if (centerX > viewport.width * 0.55 && anchor.left - gap - size.width >= 8) {
    return { left: anchor.left - gap - size.width, top: clamp(anchor.top, 8, viewport.height - size.height - 8), side: 'left' };
  }
  const belowFits = anchor.bottom + gap + size.height <= viewport.height - 8;
  const top = belowFits ? anchor.bottom + gap : Math.max(8, anchor.top - gap - size.height);
  return { left: clamp(anchor.left, 8, viewport.width - size.width - 8), top, side: belowFits ? 'below' : 'above' };
}
