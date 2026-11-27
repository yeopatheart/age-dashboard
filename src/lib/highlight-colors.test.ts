import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIGHLIGHT_COLORS, highlightColorOf, nextHighlightPosition } from './highlight-colors.ts';

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// CIELAB 색 차이(CIE76). 색 목록을 바꿀 때 비슷한 색이 들어오는 것을 막는 하한선이다.
const lab = (hex: string) => {
  const [r, g, b] = [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const distance = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// 칩 바탕: 최초(slate-50)·추가(emerald-50)·수정(amber-50). 상태 칸의 일반 상품명 글자색: 추가(emerald-700)·수정(amber-700).
const CHIP_BACKGROUNDS = ['#f8fafc', '#ecfdf5', '#fffbeb'];
const STATUS_TEXT = ['#047857', '#b45309'];
// CIE76 하한(2026-11-27 색 목록의 실제 값: 앞 3색 81.9, 나머지 43.4, 상태 글자와 35.1). 예전 6색의 최소는 39.3이었다.
const FLOOR_FIRST = 70;
const FLOOR_REST = 42;
const FLOOR_STATUS = 30;

test('강조색은 서로 충분히 다르다(앞 3색은 더 멀다)', () => {
  for (let i = 0; i < HIGHLIGHT_COLORS.length; i++) {
    for (let j = i + 1; j < HIGHLIGHT_COLORS.length; j++) {
      const d = distance(HIGHLIGHT_COLORS[i], HIGHLIGHT_COLORS[j]);
      const floor = j < 3 ? FLOOR_FIRST : FLOOR_REST;
      assert.ok(d >= floor, `${i + 1}번 ↔ ${j + 1}번: ${d.toFixed(0)} < ${floor}`);
    }
  }
});

test('칩 바탕에서 읽힌다(대비 4.5 이상)', () => {
  for (const c of HIGHLIGHT_COLORS) for (const bg of CHIP_BACKGROUNDS) assert.ok(contrast(c, bg) >= 4.5, `${c} on ${bg}: ${contrast(c, bg).toFixed(2)}`);
});

// 첫 색(빨강)은 예전부터 써 온 색이라 제외한다: 2번째부터는 "추가·수정" 칸의 일반 글자색과 헷갈리지 않아야 한다.
test('2번째 이후 색은 추가·수정 칸의 일반 상품명 글자색과 다르다', () => {
  for (const c of HIGHLIGHT_COLORS.slice(1)) for (const s of STATUS_TEXT) assert.ok(distance(c, s) >= FLOOR_STATUS, `${c} ↔ ${s}: ${distance(c, s).toFixed(0)}`);
});

test('nextHighlightPosition: 처음부터 고르면 0, 1, 2 …', () => {
  const used: number[] = [];
  for (let i = 0; i < 8; i++) used.push(nextHighlightPosition(used));
  assert.deepEqual(used, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('해제해도 남은 상품의 색은 그대로이고, 새 상품은 빈 색을 받는다', () => {
  const remaining = [1, 2]; // 첫 번째(0)를 해제
  assert.deepEqual(remaining.map((p) => highlightColorOf(p)), [HIGHLIGHT_COLORS[1], HIGHLIGHT_COLORS[2]]);
  assert.equal(highlightColorOf(nextHighlightPosition(remaining)), HIGHLIGHT_COLORS[0]);
});

test('7번째 이후에도 빈 색이 있으면 반드시 빈 색을 받는다', () => {
  // 0~5 + 6(첫 색 한 번 더)에서 4번째 색(3)을 해제 → 그 색이 비었으므로 그 색
  const used = [1, 2, 4, 5, 6];
  assert.equal(highlightColorOf(nextHighlightPosition(used)), HIGHLIGHT_COLORS[3]);
});

test('nextHighlightPosition은 이미 쓰는 번호를 다시 주지 않는다', () => {
  for (const used of [[0], [1, 2, 3, 4, 5, 6], [0, 6, 12], [5, 11, 0, 1]]) assert.ok(!used.includes(nextHighlightPosition(used)));
});
