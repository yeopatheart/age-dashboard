import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_HUES, softenColors, softenHex } from './color-palette.ts';

test('softenHex: CSS saturate(0.75) brightness(0.96)와 같은 계산', () => {
  assert.equal(softenHex('#ffffff'), '#f5f5f5'); // 흰색은 채도가 없어 밝기만 줄어든다
  assert.equal(softenHex('#808080'), '#7b7b7b');
  assert.equal(softenHex('#ff0000'), '#c50d0d'); // 채도가 줄어 순빨강이 덜 진해진다
});

test('softenHex: 6자리 hex가 아니면 그대로 둔다', () => {
  assert.equal(softenHex('red'), 'red');
  assert.equal(softenHex('#fff'), '#fff');
});

test('팔레트의 모든 색이 유효한 hex로 바뀌고 밝기(휘도)는 0.96배가 된다', () => {
  // saturate는 휘도를 보존하고 brightness가 0.96배를 곱하므로, 반올림 오차(±3) 안에서 휘도가 0.96배여야 한다.
  const luma = (hex: string) => 0.213 * parseInt(hex.slice(1, 3), 16) + 0.715 * parseInt(hex.slice(3, 5), 16) + 0.072 * parseInt(hex.slice(5, 7), 16);
  for (const hue of COLOR_HUES) {
    const soft = softenColors(hue);
    for (const key of ['fill', 'border', 'text'] as const) {
      assert.match(soft[key], /^#[0-9a-f]{6}$/);
      assert.ok(Math.abs(luma(soft[key]) - 0.96 * luma(hue[key])) <= 3, `${hue.key}.${key}`);
    }
  }
});
