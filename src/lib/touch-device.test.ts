import test from 'node:test';
import assert from 'node:assert/strict';
import { isTouchDesktop } from './touch-device.ts';

const board = { maxTouchPoints: 2, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36', width: 1280 };

test('the smart whiteboard (Linux Chrome, 2 touch points, 1280px) is detected', () => {
  assert.equal(isTouchDesktop(board), true);
});

test('a mouse-only PC is not a board', () => {
  assert.equal(isTouchDesktop({ ...board, maxTouchPoints: 0 }), false);
  assert.equal(isTouchDesktop({ ...board, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/143.0.0.0 Safari/537.36', maxTouchPoints: 0 }), false);
});

test('phones and tablets are excluded', () => {
  assert.equal(isTouchDesktop({ maxTouchPoints: 5, width: 390, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' }), false);
  assert.equal(isTouchDesktop({ maxTouchPoints: 5, width: 1180, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/143.0.0.0 Safari/537.36' }), false);
  assert.equal(isTouchDesktop({ maxTouchPoints: 5, width: 1180, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel' }), false);
});

test('a narrow window is treated as a phone layout', () => {
  assert.equal(isTouchDesktop({ ...board, width: 768 }), false);
  assert.equal(isTouchDesktop({ ...board, width: 769 }), true);
});
