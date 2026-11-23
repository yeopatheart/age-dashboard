import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_INSIDE_RATIO, balloonPosition, businessInsidePx, pickStickerTarget, scopeAreas, stickerHeightPx } from './sticker-ui.ts';

const chip = (itemId: string, left: number, top: number, w = 80, h = 18) => ({ itemId, rect: { left, top, right: left + w, bottom: top + h } });
const badge = (stickerId: string, itemId: string, left: number, top: number, w = 24, h = 11) => ({ stickerId, itemId, rect: { left, top, right: left + w, bottom: top + h } });

test('눌린 곳이 칸 안이면 그 칸', () => {
  assert.deepEqual(pickStickerTarget(50, 10, [], [chip('a', 0, 0), chip('b', 100, 0)]), { kind: 'chip', itemId: 'a' });
  assert.deepEqual(pickStickerTarget(130, 10, [], [chip('a', 0, 0), chip('b', 100, 0)]), { kind: 'chip', itemId: 'b' });
});

test('칸 밖이면 아무것도 아니다', () => {
  assert.equal(pickStickerTarget(90, 10, [], [chip('a', 0, 0), chip('b', 100, 0)]), null);
});

test('스티커 배지가 칸보다 먼저다(칸 안에 있어도)', () => {
  const t = pickStickerTarget(60, 8, [badge('s1', 'a', 52, 3)], [chip('a', 0, 0)]);
  assert.deepEqual(t, { kind: 'badge', stickerId: 's1', itemId: 'a' });
});

test('배지는 조금 빗나가도 맞고, 너무 멀면 칸으로 본다', () => {
  // 배지는 x 52~76. 오른쪽 끝에서 2px 밖(78)까지는 배지, 3px 밖(79)부터는 칸이다.
  assert.deepEqual(pickStickerTarget(78, 8, [badge('s1', 'a', 52, 3)], [chip('a', 0, 0)]), { kind: 'badge', stickerId: 's1', itemId: 'a' });
  assert.deepEqual(pickStickerTarget(79, 8, [badge('s1', 'a', 52, 3)], [chip('a', 0, 0)]), { kind: 'chip', itemId: 'a' });
});

test('이웃 칸에 나온 스티커도 눌린다(칸 밖이어도)', () => {
  const t = pickStickerTarget(120, 25, [badge('s1', 'a', 110, 20)], [chip('a', 0, 0), chip('b', 100, 0)]);
  assert.deepEqual(t, { kind: 'badge', stickerId: 's1', itemId: 'a' });
});

test('배지가 겹치면 더 작은 것이 이긴다', () => {
  const t = pickStickerTarget(60, 8, [badge('big', 'a', 50, 2, 40, 14), badge('small', 'a', 55, 5, 10, 8)], []);
  assert.deepEqual(t, { kind: 'badge', stickerId: 'small', itemId: 'a' });
});

test('말풍선은 칸 바로 아래, 자리가 없으면 위, 화면 안에 가둔다', () => {
  const view = { width: 1280, height: 720 };
  const size = { width: 232, height: 150 };
  assert.deepEqual(balloonPosition({ left: 400, top: 100, right: 480, bottom: 118 }, size, view), { left: 400, top: 124 });
  assert.deepEqual(balloonPosition({ left: 400, top: 650, right: 480, bottom: 668 }, size, view), { left: 400, top: 650 - 6 - 150 });
  assert.equal(balloonPosition({ left: 1200, top: 100, right: 1270, bottom: 118 }, size, view).left, 1280 - 232 - 8);
  assert.equal(balloonPosition({ left: -20, top: 100, right: 40, bottom: 118 }, size, view).left, 8);
});

const nameCell = (dailyBusinessId: string, left: number, top: number, w = 90, h = 18) => ({ dailyBusinessId, rect: { left, top, right: left + w, bottom: top + h } });
const bizBadge = (stickerId: string, dailyBusinessId: string, left: number, top: number, w = 30, h = 11) => ({ stickerId, dailyBusinessId, rect: { left, top, right: left + w, bottom: top + h } });

test('고객명 칸을 누르면 그 고객사', () => {
  assert.deepEqual(pickStickerTarget(40, 30, [], [chip('a', 100, 18)], [nameCell('d1', 0, 0), nameCell('d2', 0, 18)]), { kind: 'name', dailyBusinessId: 'd2' });
});

test('고객명 칸과 상품 칸은 서로 다른 열이라 눌린 곳에 맞는 쪽이 골라진다', () => {
  const names = [nameCell('d1', 0, 0)];
  const chips = [chip('a', 100, 0)];
  assert.deepEqual(pickStickerTarget(10, 5, [], chips, names), { kind: 'name', dailyBusinessId: 'd1' });
  assert.deepEqual(pickStickerTarget(120, 5, [], chips, names), { kind: 'chip', itemId: 'a' });
  assert.equal(pickStickerTarget(95, 5, [], chips, names), null); // 두 칸 사이
});

test('고객사 스티커가 윗줄 고객명 칸에 걸쳐 있어도 그 자리를 누르면 스티커가 먼저 맞는다', () => {
  // 윗줄 고객명 칸(0~18)의 아래쪽 끝에 걸친 고객사 스티커(아랫줄 d2 소속, y 10~21)
  const names = [nameCell('d1', 0, 0), nameCell('d2', 0, 18)];
  const badges = [bizBadge('s9', 'd2', 55, 10)];
  assert.deepEqual(pickStickerTarget(70, 14, badges, [], names), { kind: 'business-badge', stickerId: 's9', dailyBusinessId: 'd2' });
  assert.deepEqual(pickStickerTarget(20, 14, badges, [], names), { kind: 'name', dailyBusinessId: 'd1' }); // 스티커 밖은 윗줄 고객명 칸
});

test('고객사 스티커와 상품 칸 스티커가 겹치지 않으면 각자 맞는다', () => {
  const badges = [bizBadge('b1', 'd1', 55, 3), badge('i1', 'a', 150, 3)];
  assert.deepEqual(pickStickerTarget(60, 5, badges, [chip('a', 100, 0)], [nameCell('d1', 0, 0)]), { kind: 'business-badge', stickerId: 'b1', dailyBusinessId: 'd1' });
  assert.deepEqual(pickStickerTarget(160, 5, badges, [chip('a', 100, 0)], [nameCell('d1', 0, 0)]), { kind: 'badge', stickerId: 'i1', itemId: 'a' });
});


test('고객사 스티커는 높이의 65%가 자기 칸 안에 들어온다', () => {
  assert.equal(BUSINESS_INSIDE_RATIO, 0.65);
  assert.equal(stickerHeightPx(9), 10.35);
  assert.equal(businessInsidePx(9), 6.7); // 10.35 × 0.65 = 6.73
  assert.equal(businessInsidePx(11), 8.2); // 12.65 × 0.65 = 8.22
  assert.ok(businessInsidePx(7) < stickerHeightPx(7) && businessInsidePx(7) > stickerHeightPx(7) / 2); // 절반보다 많이, 전부는 아니게
});

const geo = {
  body: { left: 100, top: 50, right: 1000, bottom: 600 },
  row: { left: 100, top: 50, right: 1000, bottom: 68 },
  name: { left: 200, top: 50, right: 320, bottom: 68 },
  box: { left: 320, top: 50, right: 384, bottom: 68 },
};

test('고객사용: 고객명 열이 붙일 수 있는 열이고 양옆 열은 덮인다', () => {
  const a = scopeAreas('business', geo);
  assert.deepEqual(a?.target, { left: 200, right: 320, top: 50, bottom: 600 });
  assert.deepEqual(a?.veils, [{ left: 100, right: 200, top: 50, bottom: 600 }, { left: 320, right: 1000, top: 50, bottom: 600 }]);
});

test('상품 칸용: 박스 열 오른쪽 전체가 붙일 수 있는 열이고 왼쪽 열들은 덮인다', () => {
  const a = scopeAreas('item', geo);
  assert.deepEqual(a?.target, { left: 384, right: 1000, top: 50, bottom: 600 });
  assert.deepEqual(a?.veils, [{ left: 100, right: 384, top: 50, bottom: 600 }]);
});

test('줄이 본문 상자보다 넓으면 상자 안으로 잘라 그린다', () => {
  const a = scopeAreas('item', { ...geo, row: { ...geo.row, left: 0, right: 1400 } });
  assert.deepEqual(a?.target, { left: 384, right: 1000, top: 50, bottom: 600 });
  assert.deepEqual(a?.veils, [{ left: 100, right: 384, top: 50, bottom: 600 }]);
});

test('붙일 열이 상자 밖으로 밀려나 안 보이면 null이다(가로 스크롤)', () => {
  assert.equal(scopeAreas('business', { ...geo, name: { left: 1100, top: 50, right: 1220, bottom: 68 }, box: { left: 1220, top: 50, right: 1284, bottom: 68 } }), null);
  assert.equal(scopeAreas('item', { ...geo, body: { left: 100, top: 50, right: 1000, bottom: 50 } }), null);
});

test('덮을 열이 없으면(고객명 열이 맨 왼쪽) 있는 것만 돌려준다', () => {
  const a = scopeAreas('business', { ...geo, name: { left: 100, top: 50, right: 220, bottom: 68 }, box: { left: 220, top: 50, right: 284, bottom: 68 } });
  assert.deepEqual(a?.veils, [{ left: 220, right: 1000, top: 50, bottom: 600 }]);
});
