import test from 'node:test';
import assert from 'node:assert/strict';
import { barLayout, cardPosition, clampBar } from './ink/menu-layout.ts';

const view = { width: 1280, height: 720 };
const spec = { button: 40, gap: 6, handle: 22 };

test('the bar is a handle on top and the buttons below it in order', () => {
  const bar = barLayout({ x: 1200, y: 360 }, 3, spec);
  assert.equal(bar.width, 40);
  assert.equal(bar.height, 22 + 3 * 46); // 160
  assert.equal(bar.left, 1180);
  assert.equal(bar.top, 280);
  assert.deepEqual(bar.handle, { x: 1200, y: 291 });
  assert.deepEqual(bar.buttons, [{ x: 1200, y: 280 + 22 + 6 + 20 }, { x: 1200, y: 280 + 22 + 6 + 46 + 20 }, { x: 1200, y: 280 + 22 + 6 + 92 + 20 }]);
});

test('buttons never overlap each other or the handle', () => {
  const bar = barLayout({ x: 100, y: 300 }, 4, spec);
  const tops = [bar.handle.y - spec.handle / 2, ...bar.buttons.map((b) => b.y - spec.button / 2)];
  const bottoms = [bar.handle.y + spec.handle / 2, ...bar.buttons.map((b) => b.y + spec.button / 2)];
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] >= bottoms[i - 1], `item ${i} overlaps the one above`);
  assert.equal(bottoms[bottoms.length - 1], bar.top + bar.height); // the last button ends exactly at the bar's bottom edge
});

test('a bar with no buttons is just the handle', () => {
  const bar = barLayout({ x: 100, y: 100 }, 0, spec);
  assert.equal(bar.height, 22);
  assert.deepEqual(bar.buttons, []);
});

test('dragging keeps the whole bar inside the screen', () => {
  const size = { width: 40, height: 160 };
  assert.deepEqual(clampBar({ x: -50, y: 900 }, size, view), { x: 24, y: 720 - 80 - 4 });
  assert.deepEqual(clampBar({ x: 5000, y: -10 }, size, view), { x: 1280 - 20 - 4, y: 84 });
  assert.deepEqual(clampBar({ x: 500, y: 300 }, size, view), { x: 500, y: 300 });
});

test('the card goes to the left of the bar when the bar is on the right half', () => {
  const pos = cardPosition({ x: 1240, y: 360 }, 300, { width: 264, height: 188 }, 40, view);
  assert.equal(pos.x, 1240 - 20 - 12 - 264);
  assert.equal(pos.y, 300 - 94);
});

test('the card goes to the right of the bar when the bar is on the left half', () => {
  const pos = cardPosition({ x: 60, y: 360 }, 300, { width: 264, height: 132 }, 40, view);
  assert.equal(pos.x, 60 + 20 + 12);
});

test('the card is kept inside the screen', () => {
  const pos = cardPosition({ x: 1240, y: 600 }, 30, { width: 264, height: 188 }, 40, view);
  assert.ok(pos.y >= 8 && pos.y + 188 <= 720 - 8);
});
