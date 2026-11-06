import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnicodeRange, rangesCover, textCodepoints } from './receipt-font-subset.ts';

test('parseUnicodeRange reads single values, ranges and wildcards', () => {
  assert.deepEqual(parseUnicodeRange('U+AC00-AD7F, u+20, U+4??'), [[0xac00, 0xad7f], [0x20, 0x20], [0x400, 0x4ff]]);
  assert.deepEqual(parseUnicodeRange('U+f9ca-fa0b'), [[0xf9ca, 0xfa0b]]);
});

test('parseUnicodeRange skips unreadable parts', () => {
  assert.deepEqual(parseUnicodeRange('nonsense, U+41'), [[0x41, 0x41]]);
  assert.deepEqual(parseUnicodeRange(''), []);
});

test('textCodepoints ignores whitespace and keeps Korean syllables', () => {
  const set = textCodepoints('영 수\n증 A');
  assert.equal(set.has('영'.codePointAt(0)!), true);
  assert.equal(set.has(0x20), false);
  assert.equal(set.has(0x41), true);
});

test('rangesCover is true when any used character falls inside a range', () => {
  const used = textCodepoints('영수증');
  assert.equal(rangesCover(parseUnicodeRange('U+C601, U+D55C'), used), true); // 영 = U+C601
  assert.equal(rangesCover(parseUnicodeRange('U+0041-005A'), used), false);
  assert.equal(rangesCover([], used), true); // 범위가 없으면 전체를 덮는 조각
});
