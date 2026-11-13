import test from 'node:test';
import assert from 'node:assert/strict';
import { backingSize, endInk, extendInk, startInk } from './ink/canvas.ts';

// 그리기 호출을 기록하는 가짜 컨텍스트
function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    lineWidth: 4,
    strokeStyle: '#dc2626',
    fillStyle: '',
    beginPath: () => calls.push('begin'),
    moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => calls.push(`quad ${cx},${cy} ${x},${y}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y} r${r}`),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

test('the canvas backing size is the CSS size times devicePixelRatio (whiteboard: 3)', () => {
  assert.deepEqual(backingSize(1280, 720, 3), { width: 3840, height: 2160 });
  assert.deepEqual(backingSize(900, 400, 1), { width: 900, height: 400 });
});

test('fractional ratios round to whole pixels and never reach zero', () => {
  assert.deepEqual(backingSize(1001, 333, 1.25), { width: 1251, height: 416 });
  assert.deepEqual(backingSize(0, 0, 3), { width: 1, height: 1 });
});

test('an invalid ratio falls back to 1', () => {
  assert.deepEqual(backingSize(100, 50, 0), { width: 100, height: 50 });
  assert.deepEqual(backingSize(100, 50, -2), { width: 100, height: 50 });
});

test('a stroke is drawn as curves through the midpoints, using the previous point as the control point', () => {
  const { ctx, calls } = fakeCtx();
  let cursor = startInk({ x: 0, y: 0 });
  cursor = extendInk(ctx, cursor, { x: 10, y: 0 });
  assert.deepEqual(calls, ['begin', 'move 0,0', 'quad 0,0 5,0', 'stroke']);
  calls.length = 0;
  cursor = extendInk(ctx, cursor, { x: 10, y: 10 });
  assert.deepEqual(calls, ['begin', 'move 5,0', 'quad 10,0 10,5', 'stroke']);
  assert.deepEqual(cursor, { last: { x: 10, y: 10 }, mid: { x: 10, y: 5 } });
});

test('the end of a stroke connects the last midpoint to the last point', () => {
  const { ctx, calls } = fakeCtx();
  const cursor = extendInk(ctx, startInk({ x: 0, y: 0 }), { x: 10, y: 0 });
  calls.length = 0;
  endInk(ctx, cursor);
  assert.deepEqual(calls, ['begin', 'move 5,0', 'line 10,0', 'stroke']);
});

test('a tap (a single point) is drawn as a dot', () => {
  const { ctx, calls } = fakeCtx();
  endInk(ctx, startInk({ x: 7, y: 9 }));
  assert.deepEqual(calls, ['begin', 'arc 7,9 r2', 'fill']);
});
