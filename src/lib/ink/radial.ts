// 플로팅 버튼 둘레에 도구 버튼을 사방으로 펼치는 배치(순수 함수).
// 버튼이 화면 한가운데 쪽에 있어 사방에 자리가 있으면 원을 따라 고르게 펼치고, 가장자리에 가까우면 화면 안쪽으로 부채꼴로 펼친다.
import type { Pt } from './canvas.ts';

const FAN_SPACING_DEG = 55; // 부채꼴로 펼 때 버튼 사이의 각도

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export function radialPositions(center: Pt, count: number, radius: number, viewport: { width: number; height: number }, margin: number): Pt[] {
  if (count <= 0) return [];
  const roomAround = center.x - radius >= margin && center.x + radius <= viewport.width - margin && center.y - radius >= margin && center.y + radius <= viewport.height - margin;
  const angles: number[] = [];
  if (roomAround) {
    for (let i = 0; i < count; i++) angles.push(-Math.PI / 2 + (i * 2 * Math.PI) / count); // 위쪽부터 시계 방향
  } else {
    const dx = viewport.width / 2 - center.x;
    const dy = viewport.height / 2 - center.y;
    const inward = dx === 0 && dy === 0 ? -Math.PI / 2 : Math.atan2(dy, dx);
    const spacing = (FAN_SPACING_DEG * Math.PI) / 180;
    for (let i = 0; i < count; i++) angles.push(inward + (i - (count - 1) / 2) * spacing);
  }
  return angles.map((a) => ({
    x: clamp(center.x + radius * Math.cos(a), margin, viewport.width - margin),
    y: clamp(center.y + radius * Math.sin(a), margin, viewport.height - margin),
  }));
}

// 옵션 카드(색·굵기·크기 조절)를 버튼 아래에 둘지 위에 둘지: 아래에 자리가 있으면 아래, 아니면 위.
export function cardPlacement(center: Pt, cardHeight: number, viewportHeight: number, gap: number): 'below' | 'above' {
  return center.y + gap + cardHeight <= viewportHeight ? 'below' : 'above';
}

// 버튼을 끌어 옮길 때 화면 밖으로 나가지 않게 가둔다.
export function clampToViewport(p: Pt, viewport: { width: number; height: number }, margin: number): Pt {
  return { x: clamp(p.x, margin, viewport.width - margin), y: clamp(p.y, margin, viewport.height - margin) };
}
