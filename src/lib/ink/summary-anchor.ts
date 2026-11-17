// 모니터 2의 "품목별 수량" 패널 칩에 필기를 붙이는 규칙(순수 함수).
//
// 패널 칩은 수량·품목이 바뀌면 줄이 바뀌고 폭·높이·순서가 움직이는데, 그 위에 쓴 필기는 그림 층 비율(낙서)이라 제자리에 남았다(2026-11-17 사용자 보고).
// 이제 칩 위에서 쓴 획은 그 칩의 크기에 대한 비율로 저장해서 칩을 따라간다. anchor는 `sum:<품목 키>`이고 품목 키는 `ProductSummaryRow.key`
// (`상품 id 또는 이름|사이즈|단위|준비 방식`)다. 상품 칸 anchor(상품 id, UUID)나 줄 anchor(`row:`)와 접두사가 달라 겹치지 않는다.
// 칩이 화면에 없으면(품목이 사라지거나 키가 바뀜) store.resolvePoints가 null이라 그리지 않고 보관만 한다.
import type { Pt } from './canvas.ts';
import { isRowAnchor } from './row-anchor.ts';
import type { Box } from './store.ts';

export const SUM_ANCHOR_PREFIX = 'sum:';
// 품목 키 길이 상한. 이보다 긴 키는 anchor를 만들지 않고 낙서(그림 층 비율)로 둔다 — 획마다 키가 통째로 저장되므로 저장 크기(MAX_INK_BYTES)를 지키려는 것이다.
// (저장된 anchor만 버리면 비율이 칩 기준에서 그림 층 기준으로 해석돼 위치가 틀어지므로, 만들 때 거른다.)
export const SUM_KEY_MAX_LENGTH = 200;
// 시작점 허용 오차(CSS px). 칩 사이 가로 간격이 4px(gap-x-1)이고 펜 끝이 칩 가장자리에서 조금 벗어나 시작하는 일이 흔해서 그 간격만큼만 받아 준다.
// 이보다 멀리 떨어진 빈 곳(패널 아래쪽 빈 영역, 칩 사이 큰 틈)은 낙서로 둔다. 오차는 시작점에만 적용한다(평균 위치는 칩 안이어야 한다).
export const SUM_ANCHOR_TOLERANCE_PX = 4;

export const sumAnchor = (productKey: string): string => `${SUM_ANCHOR_PREFIX}${productKey}`;
export const isSumAnchor = (anchor: string | undefined): anchor is string => typeof anchor === 'string' && anchor.startsWith(SUM_ANCHOR_PREFIX);
export const sumKeyOf = (anchor: string): string => anchor.slice(SUM_ANCHOR_PREFIX.length);

// 점에서 상자까지의 거리(안이면 0).
function distanceToBox(p: Pt, box: Box): number {
  const dx = Math.max(box.left - p.x, 0, p.x - (box.left + box.width));
  const dy = Math.max(box.top - p.y, 0, p.y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

const distanceToCenter = (p: Pt, box: Box) => Math.hypot(p.x - (box.left + box.width / 2), p.y - (box.top + box.height / 2));

// 점에서 tolerance 안에 있는 가장 가까운 패널 칩 anchor. 거리가 같으면 중심이 가까운 칩, 그래도 같으면 먼저 나온 칩.
function nearestSumChip(p: Pt, boxes: ReadonlyMap<string, Box>, tolerance: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  let bestCenter = Infinity;
  for (const [anchor, box] of boxes) {
    if (!isSumAnchor(anchor) || sumKeyOf(anchor).length > SUM_KEY_MAX_LENGTH) continue;
    const d = distanceToBox(p, box);
    if (d > tolerance) continue;
    const c = distanceToCenter(p, box);
    if (d < bestDist || (d === bestDist && c < bestCenter)) {
      best = anchor;
      bestDist = d;
      bestCenter = c;
    }
  }
  return best;
}

// 획이 속한 패널 칩: 획 점들의 평균 위치가 들어 있는 칩. 평균이 어느 칩 안도 아니면 시작점이 칩 안(또는 허용 오차 안)인 칩. 어느 칩도 아니면 null(낙서).
export function pickSumAnchor(points: readonly Pt[], boxes: ReadonlyMap<string, Box>): string | null {
  if (points.length === 0) return null;
  const mean = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  return nearestSumChip(mean, boxes, 0) ?? nearestSumChip(points[0], boxes, SUM_ANCHOR_TOLERANCE_PX);
}

// 상품 칸 anchor(상품 id): 줄(`row:`)도 패널 칩(`sum:`)도 아닌 것. 동그라미·직선 판정 대상이고, 지우개가 닿으면 포장 완료를 원복하는 대상이다.
export const isProductAnchor = (anchor: string | undefined): anchor is string => anchor !== undefined && !isRowAnchor(anchor) && !isSumAnchor(anchor);

// 동그라미·직선 판정 대상은 표의 상품 칸뿐이다(줄과 패널 칩은 제외). 패널 칩을 상품 칸으로 오인하면 패널에 쓴 동그라미가 포장 처리가 되거나 낙서가 된다.
export const chipTargets = (boxes: ReadonlyMap<string, Box>) => [...boxes].filter(([key]) => isProductAnchor(key)).map(([id, box]) => ({ id, ...box }));
