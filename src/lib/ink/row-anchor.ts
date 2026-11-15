// 칠판 필기를 "그 줄"에 붙이는 규칙(순수 함수).
//
// 예전에는 상품 칸을 동그라미·직선으로 표시한 획만 칸에 붙고, 나머지 글씨·낙서는 그림 층 크기에 대한 비율로만 저장했다.
// 주문이 늘어 줄 높이가 바뀌거나 줄 위치가 움직이면 비율로 저장한 글씨는 제자리에 남아 엉뚱한 줄 위에 얹혔다(2026-11-16 현장).
// 이제 줄 안에서 시작한 획은 그 줄(업체 카드)의 크기에 대한 비율로 저장해서 줄이 커지고 줄어들고 움직여도 따라간다.
// 상품 칸 anchor는 상품 id(UUID), 줄 anchor는 `row:업체카드id`라 서로 겹치지 않는다. 줄 밖에서 쓴 획만 예전처럼 그림 층 비율(anchor 없음)로 둔다.
import type { Pt } from './canvas.ts';
import { resolvePoints, toAnchoredStroke, type Box, type InkStroke } from './store.ts';

export const ROW_ANCHOR_PREFIX = 'row:';

export const rowAnchor = (dailyBusinessId: string): string => `${ROW_ANCHOR_PREFIX}${dailyBusinessId}`;
export const isRowAnchor = (anchor: string | undefined): anchor is string => typeof anchor === 'string' && anchor.startsWith(ROW_ANCHOR_PREFIX);

function rowContaining(p: Pt, boxes: ReadonlyMap<string, Box>): string | null {
  for (const [anchor, box] of boxes) {
    if (!isRowAnchor(anchor)) continue;
    if (p.y >= box.top && p.y < box.top + box.height && p.x >= box.left && p.x < box.left + box.width) return anchor;
  }
  return null;
}

// 획이 속한 줄: 획 점들의 평균 위치가 들어 있는 줄. 평균이 줄 밖(줄 사이 경계 등)이면 시작점이 들어 있는 줄. 어느 줄도 아니면 null.
export function pickRowAnchor(points: readonly Pt[], boxes: ReadonlyMap<string, Box>): string | null {
  if (points.length === 0) return null;
  const mean = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  return rowContaining(mean, boxes) ?? rowContaining(points[0], boxes);
}

// 예전 방식으로 저장된 획(anchor 없음)을 지금 보이는 줄에 붙인다. 지금 화면에서 보이는 위치를 그대로 유지한 채 저장 방식만 바꾼다.
// 어느 줄에도 들어가지 않는 획은 그대로 둔다. 바뀐 것이 없으면 같은 배열을 돌려준다.
export function anchorLegacyStrokes(strokes: readonly InkStroke[], layer: { width: number; height: number }, boxes: ReadonlyMap<string, Box>): InkStroke[] {
  let changed = false;
  const out = strokes.map((stroke) => {
    if (stroke.anchor !== undefined) return stroke;
    const points = resolvePoints(stroke, layer);
    if (!points || points.length < 2) return stroke;
    const anchor = pickRowAnchor(points, boxes);
    const box = anchor ? boxes.get(anchor) : undefined;
    if (!anchor || !box) return stroke;
    changed = true;
    return toAnchoredStroke({ id: stroke.id, color: stroke.color, width: stroke.width }, points, anchor, box);
  });
  return changed ? out : (strokes as InkStroke[]);
}
