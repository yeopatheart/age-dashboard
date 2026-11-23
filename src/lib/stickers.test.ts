import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STICKER_DEFAULT_COLOR, STICKER_LABEL_MAX, movedOrder, normalizeStickerLabel, stickerColorKey, stickerText } from './stickers.ts';

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
