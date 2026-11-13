import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPlacement, clampToViewport, radialPositions } from './ink/radial.ts';

const view = { width: 1280, height: 720 };

test('in the middle of the screen the tools spread around the button in a full circle', () => {
  const slots = radialPositions({ x: 640, y: 360 }, 4, 90, view, 36);
  assert.equal(slots.length, 4);
  // 위, 오른쪽, 아래, 왼쪽(반올림 오차 허용)
  const expected = [{ x: 640, y: 270 }, { x: 730, y: 360 }, { x: 640, y: 450 }, { x: 550, y: 360 }];
  slots.forEach((s, i) => {
    assert.ok(Math.abs(s.x - expected[i].x) < 0.001 && Math.abs(s.y - expected[i].y) < 0.001);
  });
});

test('near the bottom-right corner the tools fan out toward the inside of the screen', () => {
  const center = { x: 1240, y: 680 };
  const slots = radialPositions(center, 3, 90, view, 36);
  for (const s of slots) {
    assert.ok(s.x >= 36 && s.x <= 1280 - 36 && s.y >= 36 && s.y <= 720 - 36);
  }
  // 평균적으로 화면 안쪽(왼쪽 위)을 향한다
  const meanDx = slots.reduce((sum, s) => sum + (s.x - center.x), 0) / slots.length;
  const meanDy = slots.reduce((sum, s) => sum + (s.y - center.y), 0) / slots.length;
  assert.ok(meanDx < -30 && meanDy < -30);
  // 서로 다른 자리에 놓인다
  assert.equal(new Set(slots.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`)).size, 3);
});

test('the fan faces the middle of the screen from any edge', () => {
  const left = radialPositions({ x: 40, y: 360 }, 3, 90, view, 36);
  assert.ok(left.every((s) => s.x > 40));
  const top = radialPositions({ x: 640, y: 40 }, 3, 90, view, 36);
  assert.ok(top.every((s) => s.y > 40));
});

test('zero tools gives no slots', () => {
  assert.deepEqual(radialPositions({ x: 10, y: 10 }, 0, 90, view, 36), []);
});

test('the option card goes below the button when it fits, otherwise above', () => {
  assert.equal(cardPlacement({ x: 640, y: 300 }, 160, 720, 40), 'below');
  assert.equal(cardPlacement({ x: 640, y: 650 }, 160, 720, 40), 'above');
});

test('dragging the button is kept inside the screen', () => {
  assert.deepEqual(clampToViewport({ x: -50, y: 900 }, view, 30), { x: 30, y: 690 });
  assert.deepEqual(clampToViewport({ x: 500, y: 300 }, view, 30), { x: 500, y: 300 });
});
