import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternativesFor, decodeAlternatives, encodeAlternatives, type PlacementInput } from './sticker-placement.ts';

const base: PlacementInput = { slotIndex: 1, ownItemCount: 3, ownHasMemo: false, slotCount: 5, above: null, below: null };

test('이웃이 없으면 반투명 얹기만 남는다', () => {
  assert.deepEqual(alternativesFor(base), ['overlay']);
});

test('오른쪽 빈 칸은 그 줄의 마지막 상품이고 새 열 없이 빈 칸이 있을 때만', () => {
  assert.deepEqual(alternativesFor({ ...base, slotIndex: 2 }), ['side', 'overlay']);
  assert.deepEqual(alternativesFor({ ...base, slotIndex: 1 }), ['overlay']); // 가운데 칸: 오른쪽은 다른 상품
});

test('상품이 가장 많은 줄(열이 꽉 참)은 오른쪽 빈 칸이 없다', () => {
  assert.deepEqual(alternativesFor({ ...base, ownItemCount: 5, slotIndex: 4 }), ['overlay']);
});

test('업체 메모가 있는 줄은 오른쪽 빈 칸을 쓰지 못한다', () => {
  assert.deepEqual(alternativesFor({ ...base, slotIndex: 2, ownHasMemo: true }), ['overlay']);
});

test('아래 줄의 같은 열이 비어 있으면 below, 그다음이 above', () => {
  const emptyRow = { itemCount: 1, hasMemo: false };
  assert.deepEqual(alternativesFor({ ...base, below: emptyRow, above: emptyRow }), ['below', 'above', 'overlay']);
  assert.deepEqual(alternativesFor({ ...base, above: emptyRow }), ['above', 'overlay']);
});

test('이웃 줄의 같은 열에 상품이 있으면 비어 있지 않다', () => {
  assert.deepEqual(alternativesFor({ ...base, below: { itemCount: 2, hasMemo: false } }), ['overlay']); // 열 1은 상품 2개짜리 줄에서 차 있음
  assert.deepEqual(alternativesFor({ ...base, below: { itemCount: 1, hasMemo: false } }), ['below', 'overlay']);
});

test('메모가 있는 이웃 줄의 빈 칸은 비어 있지 않은 것으로 본다', () => {
  assert.deepEqual(alternativesFor({ ...base, below: { itemCount: 0, hasMemo: true } }), ['overlay']);
});

test('오른쪽 빈 칸이 아래·위보다 먼저다', () => {
  const emptyRow = { itemCount: 0, hasMemo: false };
  assert.deepEqual(alternativesFor({ ...base, slotIndex: 2, below: emptyRow, above: emptyRow }), ['side', 'below', 'above', 'overlay']);
});

test('첫 줄(위 없음)·마지막 줄(아래 없음)은 있는 쪽만', () => {
  const emptyRow = { itemCount: 0, hasMemo: false };
  assert.deepEqual(alternativesFor({ ...base, above: null, below: emptyRow }), ['below', 'overlay']);
  assert.deepEqual(alternativesFor({ ...base, above: emptyRow, below: null }), ['above', 'overlay']);
});

test('속성 문자열로 주고받는다', () => {
  assert.equal(encodeAlternatives(['side', 'overlay']), 'side,overlay');
  assert.deepEqual(decodeAlternatives('side,below,overlay'), ['side', 'below', 'overlay']);
  assert.deepEqual(decodeAlternatives(undefined), ['overlay']);
  assert.deepEqual(decodeAlternatives('엉뚱한값'), ['overlay']);
});
