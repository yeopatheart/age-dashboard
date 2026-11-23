// 칠판에서 스티커를 붙일 때 쓰는 화면 계산(순수 함수). 결정: docs/decisions/2026-11-22-stickers.md
// 칸·스티커 배지의 화면 위치는 호출하는 쪽이 DOM에서 재서 넘긴다.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type StickerTarget =
  | { kind: 'badge'; stickerId: string; itemId: string }
  | { kind: 'chip'; itemId: string }
  // 고객사 스티커(고객명 칸 오른쪽 위)와 고객명 칸(2026-11-23)
  | { kind: 'business-badge'; stickerId: string; dailyBusinessId: string }
  | { kind: 'name'; dailyBusinessId: string };

export interface PickBadge {
  stickerId: string;
  rect: Rect;
  itemId?: string; // 상품 칸 스티커
  dailyBusinessId?: string; // 고객사 스티커
}

const HIT_SLOP = 2; // 배지는 줄 높이(17px 안팎) 안의 아주 작은 글자라 펜 끝이 조금 빗나가도 맞게 한다
const area = (r: Rect) => (r.right - r.left) * (r.bottom - r.top);
const contains = (r: Rect, x: number, y: number, slop = 0) => x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop;

// 눌린 곳이 무엇인지: 스티커 배지(상품 칸·고객사 모두)가 먼저(작은 것이 우선), 아니면 상품 칸이나 고객명 칸. 모두 아니면 null.
// 고객명 칸은 상품 칸과 겹치지 않는다(다른 열). 고객사 스티커는 윗줄 고객명 칸 위로 걸치지만 배지가 먼저라서 그 자리를 누르면 스티커가 맞는다.
export function pickStickerTarget(
  x: number,
  y: number,
  badges: PickBadge[],
  chips: { itemId: string; rect: Rect }[],
  names: { dailyBusinessId: string; rect: Rect }[] = [],
): StickerTarget | null {
  const badge = badges.filter((b) => contains(b.rect, x, y, HIT_SLOP)).sort((a, b) => area(a.rect) - area(b.rect))[0];
  if (badge) {
    if (badge.dailyBusinessId) return { kind: 'business-badge', stickerId: badge.stickerId, dailyBusinessId: badge.dailyBusinessId };
    if (badge.itemId) return { kind: 'badge', stickerId: badge.stickerId, itemId: badge.itemId };
    return null;
  }
  const cells = [
    ...chips.filter((c) => contains(c.rect, x, y)).map((c) => ({ target: { kind: 'chip', itemId: c.itemId } as StickerTarget, rect: c.rect })),
    ...names.filter((n) => contains(n.rect, x, y)).map((n) => ({ target: { kind: 'name', dailyBusinessId: n.dailyBusinessId } as StickerTarget, rect: n.rect })),
  ].sort((a, b) => area(a.rect) - area(b.rect));
  return cells[0]?.target ?? null;
}

// 말풍선 위치(왼쪽 위): 눌린 칸 바로 아래, 아래에 자리가 없으면 바로 위. 왼쪽은 칸에 맞추되 화면 밖으로 나가지 않게 가둔다.
export function balloonPosition(anchor: Rect, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 6, margin = 8): { left: number; top: number } {
  const below = anchor.bottom + gap;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const top = fitsBelow ? below : Math.max(margin, anchor.top - gap - size.height);
  const left = Math.min(Math.max(anchor.left, margin), Math.max(margin, viewport.width - size.width - margin));
  return { left, top };
}

// ── 고객사 스티커의 걸침 정도(2026-11-23) ────────────────────────────────────────────────────────────────
// 고객명 칸은 테두리가 없어서 스티커가 칸 경계에 2px만 걸치면 윗줄 것으로 읽힌다(운영 확인). 그래서 고객사 스티커는 높이의 BUSINESS_INSIDE_RATIO가 자기 칸 안에 들어오게 한다
// (나머지만 윗줄에 걸친다). 상품 칸 스티커는 칩에 테두리가 있어 2px 걸침 그대로다.
export const BUSINESS_INSIDE_RATIO = 0.65;
export const STICKER_LINE_HEIGHT = 1.15; // 스티커 글자 줄 높이(배율). 스티커 높이 = 글자 크기 × 이 값(세로 패딩 없음)
export const stickerHeightPx = (fontPx: number): number => fontPx * STICKER_LINE_HEIGHT;
// 스티커 맨 아래가 칸 위쪽 경계에서 아래로 내려오는 길이(px).
export const businessInsidePx = (fontPx: number): number => Math.round(stickerHeightPx(fontPx) * BUSINESS_INSIDE_RATIO * 10) / 10;

// ── 붙일 영역 강조(2026-11-23) ───────────────────────────────────────────────────────────────────────────
// 고른 스티커가 붙는 곳(상품 칸 / 고객명 칸)만 살리고 나머지 열은 연한 막으로 덮는다. 열 단위라 위아래로 스크롤해도 어긋나지 않는다.
// body = 줄들이 들어 있는 본문 상자, row = 한 줄(가로 전체), name = 고객명 칸, box = 그 오른쪽 박스 칸(상품 칸은 그 오른쪽부터 시작한다).
export interface ScopeGeometry {
  body: Rect;
  row: Rect;
  name: Rect;
  box: Rect;
}
export interface ScopeAreas {
  target: Rect; // 붙일 수 있는 열(테두리로 강조)
  veils: Rect[]; // 덮을 열들
}

// 본문 상자 안으로 가둔다(줄이 화면보다 넓어도 상자 밖은 그리지 않는다). 넓이가 없으면 null.
function within(r: Rect, body: Rect): Rect | null {
  const left = Math.max(r.left, body.left);
  const right = Math.min(r.right, body.right);
  return right - left > 0.5 && body.bottom - body.top > 0.5 ? { left, right, top: body.top, bottom: body.bottom } : null;
}

export function scopeAreas(scope: 'item' | 'business', g: ScopeGeometry): ScopeAreas | null {
  const v = (left: number, right: number) => within({ left, right, top: g.body.top, bottom: g.body.bottom }, g.body);
  const target = scope === 'business' ? v(g.name.left, g.name.right) : v(g.box.right, g.row.right);
  if (!target) return null;
  const rest = scope === 'business' ? [v(g.row.left, g.name.left), v(g.name.right, g.row.right)] : [v(g.row.left, g.box.right)];
  return { target, veils: rest.filter((r): r is Rect => r !== null) };
}
