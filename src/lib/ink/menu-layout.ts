// 칠판 도구 묶음의 배치(순수 함수). 도구 버튼(펜·지우개·되돌리기…)은 길게 눌러야 나오는 메뉴가 아니라 처음부터 세로 한 줄로 보이고,
// 맨 위의 끌기 손잡이를 끌면 묶음 전체가 움직인다(2026-11-22 사용자 결정). 설정 카드는 펜·지우개 버튼을 길게 눌렀을 때 그 옆에 둔다.
import type { Pt } from './canvas.ts';

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export interface BarSpec {
  button: number; // 버튼 지름
  gap: number; // 버튼(과 손잡이) 사이 간격
  handle: number; // 끌기 손잡이의 높이(폭은 버튼과 같다)
}

export interface BarLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  handle: Pt; // 손잡이 중심(화면 좌표)
  buttons: Pt[]; // 버튼 중심(화면 좌표), 위에서 아래 순서
}

// 묶음의 가운데(center)가 정해지면 손잡이와 버튼 N개의 위치를 돌려준다. 맨 위가 손잡이이고 그 아래로 버튼이 순서대로 놓인다.
export function barLayout(center: Pt, count: number, spec: BarSpec): BarLayout {
  const width = spec.button;
  const height = spec.handle + count * (spec.gap + spec.button);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  return {
    left,
    top,
    width,
    height,
    handle: { x: center.x, y: top + spec.handle / 2 },
    buttons: Array.from({ length: count }, (_, i) => ({ x: center.x, y: top + spec.handle + spec.gap + i * (spec.gap + spec.button) + spec.button / 2 })),
  };
}

// 묶음을 끌어 옮길 때 화면 밖으로 나가지 않게 가둔다(묶음 전체가 보이도록 가운데 좌표를 제한한다).
export function clampBar(center: Pt, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 4): Pt {
  return {
    x: clamp(center.x, size.width / 2 + margin, viewport.width - size.width / 2 - margin),
    y: clamp(center.y, size.height / 2 + margin, viewport.height - size.height / 2 - margin),
  };
}

// 설정 카드의 왼쪽 위 위치: 묶음이 화면 오른쪽 절반에 있으면 묶음의 왼쪽에, 왼쪽 절반에 있으면 오른쪽에 두고,
// 세로로는 눌린 도구 버튼과 가운데를 맞춘다. 화면 밖으로 나가지 않게 가둔다.
export function cardPosition(center: Pt, buttonY: number, card: { width: number; height: number }, barWidth: number, viewport: { width: number; height: number }, gap = 12): Pt {
  const left = center.x > viewport.width / 2 ? center.x - barWidth / 2 - gap - card.width : center.x + barWidth / 2 + gap;
  return {
    x: clamp(left, 8, viewport.width - card.width - 8),
    y: clamp(buttonY - card.height / 2, 8, viewport.height - card.height - 8),
  };
}
