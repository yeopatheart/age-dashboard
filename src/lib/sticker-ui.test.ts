import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balloonPosition, pickStickerTarget } from './sticker-ui.ts';

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
