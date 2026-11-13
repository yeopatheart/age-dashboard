// 플로팅 버튼의 메뉴 배치(순수 함수). 도구 버튼은 플로팅 버튼 위(또는 아래)로 세로로 쌓는다 — 주문 목록을 덜 가리려고
// 사방으로 펼치던 방식을 세로 목록으로 바꿨다(2026-11-14 사용자 결정). 설정 카드는 그 옆에 둔다.
import type { Pt } from './canvas.ts';

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

// 도구 버튼들의 중심. 플로팅 버튼이 화면 아래쪽 절반에 있으면 위로, 위쪽 절반에 있으면 아래로 쌓는다(화면 안쪽으로 펼치려는 것).
// 위로 쌓을 때는 첫 번째 도구가 가장 위, 마지막 도구가 플로팅 버튼 바로 위에 오고, 아래로 쌓을 때는 첫 번째가 플로팅 버튼 바로 아래에 온다.
export function stackPositions(center: Pt, count: number, pitch: number, viewport: { width: number; height: number }, margin: number): Pt[] {
  const up = center.y >= viewport.height / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: clamp(center.x, margin, viewport.width - margin),
    y: clamp(center.y + (up ? -(count - i) * pitch : (i + 1) * pitch), margin, viewport.height - margin),
  }));
}

// 설정 카드의 왼쪽 위 위치: 플로팅 버튼이 화면 오른쪽 절반에 있으면 버튼 열의 왼쪽에, 왼쪽 절반에 있으면 오른쪽에 두고,
// 세로로는 눌린 도구 버튼과 가운데를 맞춘다. 화면 밖으로 나가지 않게 가둔다.
export function cardPosition(center: Pt, buttonY: number, card: { width: number; height: number }, fab: number, viewport: { width: number; height: number }, gap = 12): Pt {
  const left = center.x > viewport.width / 2 ? center.x - fab / 2 - gap - card.width : center.x + fab / 2 + gap;
  return {
    x: clamp(left, 8, viewport.width - card.width - 8),
    y: clamp(buttonY - card.height / 2, 8, viewport.height - card.height - 8),
  };
}

// 버튼을 끌어 옮길 때 화면 밖으로 나가지 않게 가둔다.
export function clampToViewport(p: Pt, viewport: { width: number; height: number }, margin: number): Pt {
  return { x: clamp(p.x, margin, viewport.width - margin), y: clamp(p.y, margin, viewport.height - margin) };
}
