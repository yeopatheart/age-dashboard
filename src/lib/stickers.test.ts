import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STICKER_DEFAULT_COLOR, STICKER_LABEL_MAX, appendDigit, checkAddSticker, movedOrder, normalizeStickerLabel, stickerColorKey, stickerQuantityError, stickerText } from './stickers.ts';

test('칸에 보이는 글자는 수량이 있을 때만 숫자가 붙는다', () => {
  assert.equal(stickerText({ label: '특대', quantity: 2 }), '특대 2');
  assert.equal(stickerText({ label: '냉동실', quantity: null }), '냉동실');
});

test('이름은 앞뒤 공백을 지우고 안쪽 공백을 한 칸으로 줄인다', () => {
  assert.deepEqual(normalizeStickerLabel('  왕대물  '), { ok: true, label: '왕대물' });
  assert.deepEqual(normalizeStickerLabel('냉동   실'), { ok: true, label: '냉동 실' });
});

test('빈 이름은 거절한다', () => {
  assert.equal(normalizeStickerLabel('').ok, false);
  assert.equal(normalizeStickerLabel('   ').ok, false);
});

test('이름 길이는 보이는 글자 수로 센다', () => {
  assert.equal(normalizeStickerLabel('가'.repeat(STICKER_LABEL_MAX)).ok, true);
  assert.equal(normalizeStickerLabel('가'.repeat(STICKER_LABEL_MAX + 1)).ok, false);
});

test('모르는 색 key는 기본색으로 돌린다', () => {
  assert.equal(stickerColorKey('blue'), 'blue');
  assert.equal(stickerColorKey('없는색'), STICKER_DEFAULT_COLOR);
  assert.equal(stickerColorKey(null), STICKER_DEFAULT_COLOR);
});

test('순서 바꾸기는 한 칸씩 옮기고 끝에서는 null', () => {
  assert.deepEqual(movedOrder(['a', 'b', 'c'], 'b', 'up'), ['b', 'a', 'c']);
  assert.deepEqual(movedOrder(['a', 'b', 'c'], 'b', 'down'), ['a', 'c', 'b']);
  assert.equal(movedOrder(['a', 'b', 'c'], 'a', 'up'), null);
  assert.equal(movedOrder(['a', 'b', 'c'], 'c', 'down'), null);
  assert.equal(movedOrder(['a', 'b', 'c'], 'x', 'up'), null);
});

test('수량을 쓰는 스티커는 1~9999 정수만, 안 쓰는 스티커는 수량이 없어야 한다', () => {
  assert.equal(stickerQuantityError(true, 1), null);
  assert.equal(stickerQuantityError(true, 9999), null);
  assert.notEqual(stickerQuantityError(true, 0), null);
  assert.notEqual(stickerQuantityError(true, 10000), null);
  assert.notEqual(stickerQuantityError(true, 1.5), null);
  assert.notEqual(stickerQuantityError(true, null), null);
  assert.equal(stickerQuantityError(false, null), null);
  assert.notEqual(stickerQuantityError(false, 2), null);
});

test('같은 스티커는 한 칸에 한 번만, 한 칸에 최대 2개', () => {
  assert.deepEqual(checkAddSticker([], '특대'), { ok: true });
  assert.deepEqual(checkAddSticker(['냉동실'], '특대'), { ok: true });
  assert.deepEqual(checkAddSticker(['특대'], '특대'), { ok: false, reason: 'duplicate' });
  assert.deepEqual(checkAddSticker(['특대', '냉동실'], '대'), { ok: false, reason: 'limit' });
  // 2개가 가득 차 있어도 이미 있는 이름이면 "중복"이 먼저다(수정 말풍선으로 안내하려고)
  assert.deepEqual(checkAddSticker(['특대', '냉동실'], '특대'), { ok: false, reason: 'duplicate' });
});

test('전체 키패드는 4자리까지, 맨 앞 0은 받지 않는다', () => {
  assert.equal(appendDigit('', '0'), '');
  assert.equal(appendDigit('', '1'), '1');
  assert.equal(appendDigit('1', '0'), '10');
  assert.equal(appendDigit('999', '9'), '9999');
  assert.equal(appendDigit('9999', '1'), '9999');
  assert.equal(appendDigit('12', 'x'), '12');
});
