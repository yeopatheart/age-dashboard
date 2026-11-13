import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPosition, clampToViewport, stackPositions } from './ink/menu-layout.ts';

const view = { width: 1280, height: 720 };

test('in the lower half the tools stack upward, the last one right above the button', () => {
  const slots = stackPositions({ x: 1240, y: 600 }, 3, 64, view, 36);
  assert.deepEqual(slots, [{ x: 1240, y: 408 }, { x: 1240, y: 472 }, { x: 1240, y: 536 }]);
});

test('in the upper half the tools stack downward, the first one right below the button', () => {
  const slots = stackPositions({ x: 60, y: 100 }, 3, 64, view, 36);
  assert.deepEqual(slots, [{ x: 60, y: 164 }, { x: 60, y: 228 }, { x: 60, y: 292 }]);
});

test('the stack stays inside the screen', () => {
  for (const slot of stackPositions({ x: 5, y: 700 }, 3, 64, view, 36)) {
    assert.ok(slot.x >= 36 && slot.x <= 1280 - 36 && slot.y >= 36 && slot.y <= 720 - 36);
  }
});

test('zero tools gives no slots', () => {
  assert.deepEqual(stackPositions({ x: 10, y: 10 }, 0, 64, view, 36), []);
});

test('the card goes to the left of the button column when the button is on the right half', () => {
  const pos = cardPosition({ x: 1240, y: 600 }, 472, { width: 264, height: 188 }, 56, view);
  assert.equal(pos.x, 1240 - 28 - 12 - 264);
  assert.equal(pos.y, 472 - 94);
});

test('the card goes to the right of the button column when the button is on the left half', () => {
  const pos = cardPosition({ x: 60, y: 100 }, 164, { width: 264, height: 132 }, 56, view);
  assert.equal(pos.x, 60 + 28 + 12);
});

test('the card is kept inside the screen', () => {
  const pos = cardPosition({ x: 1240, y: 600 }, 30, { width: 264, height: 188 }, 56, view);
  assert.ok(pos.y >= 8 && pos.y + 188 <= 720 - 8);
});

test('dragging the button is kept inside the screen', () => {
  assert.deepEqual(clampToViewport({ x: -50, y: 900 }, view, 30), { x: 30, y: 690 });
  assert.deepEqual(clampToViewport({ x: 500, y: 300 }, view, 30), { x: 500, y: 300 });
});
