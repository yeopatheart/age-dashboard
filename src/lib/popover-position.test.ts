import test from 'node:test';
import assert from 'node:assert/strict';
import { placePopover } from './popover-position.ts';

const view = { width: 1280, height: 720 };
const card = { width: 280, height: 300 };

test('a chip in the right-hand panel gets its card on its left, aligned to the chip top', () => {
  const r = placePopover({ left: 1100, top: 200, right: 1180, bottom: 218 }, card, view);
  assert.deepEqual(r, { left: 1100 - 8 - 280, top: 200, side: 'left' });
});

test('the left-side card is kept inside the screen vertically', () => {
  const r = placePopover({ left: 1100, top: 650, right: 1180, bottom: 668 }, card, view);
  assert.equal(r.side, 'left');
  assert.equal(r.top, 720 - 300 - 8);
});

test('a chip on the left or middle gets its card below it', () => {
  const r = placePopover({ left: 200, top: 100, right: 300, bottom: 128 }, card, view);
  assert.deepEqual(r, { left: 200, top: 136, side: 'below' });
});

test('with no room below the card goes above the chip', () => {
  const r = placePopover({ left: 200, top: 600, right: 300, bottom: 628 }, card, view);
  assert.equal(r.side, 'above');
  assert.equal(r.top, 600 - 8 - 300);
});

test('a chip near the right edge but with no room on its left falls back to below and stays inside the screen', () => {
  const r = placePopover({ left: 200, top: 100, right: 1270, bottom: 128 }, card, view);
  assert.equal(r.side, 'below');
  assert.ok(r.left + 280 <= 1280 - 8 && r.left >= 8);
});
