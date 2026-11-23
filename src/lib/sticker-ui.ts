// 칠판에서 스티커를 붙일 때 쓰는 화면 계산(순수 함수). 결정: docs/decisions/2026-11-22-stickers.md
// 칸·스티커 배지의 화면 위치는 호출하는 쪽이 DOM에서 재서 넘긴다.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type StickerTarget = { kind: 'badge'; stickerId: string; itemId: string } | { kind: 'chip'; itemId: string };

const HIT_SLOP = 2; // 배지는 줄 높이(17px 안팎) 안의 아주 작은 글자라 펜 끝이 조금 빗나가도 맞게 한다
const area = (r: Rect) => (r.right - r.left) * (r.bottom - r.top);
const contains = (r: Rect, x: number, y: number, slop = 0) => x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop;

// 눌린 곳이 무엇인지: 스티커 배지가 먼저(작은 것이 우선), 아니면 상품 칸. 둘 다 아니면 null.
export function pickStickerTarget(x: number, y: number, badges: { stickerId: string; itemId: string; rect: Rect }[], chips: { itemId: string; rect: Rect }[]): StickerTarget | null {
  const badge = badges.filter((b) => contains(b.rect, x, y, HIT_SLOP)).sort((a, b) => area(a.rect) - area(b.rect))[0];
  if (badge) return { kind: 'badge', stickerId: badge.stickerId, itemId: badge.itemId };
  const chip = chips.filter((c) => contains(c.rect, x, y)).sort((a, b) => area(a.rect) - area(b.rect))[0];
  return chip ? { kind: 'chip', itemId: chip.itemId } : null;
}

// 말풍선 위치(왼쪽 위): 눌린 칸 바로 아래, 아래에 자리가 없으면 바로 위. 왼쪽은 칸에 맞추되 화면 밖으로 나가지 않게 가둔다.
export function balloonPosition(anchor: Rect, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 6, margin = 8): { left: number; top: number } {
  const below = anchor.bottom + gap;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const top = fitsBelow ? below : Math.max(margin, anchor.top - gap - size.height);
  const left = Math.min(Math.max(anchor.left, margin), Math.max(margin, viewport.width - size.width - margin));
  return { left, top };
}
