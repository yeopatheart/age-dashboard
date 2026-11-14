import test from 'node:test';
import assert from 'node:assert/strict';
import { backingSize, drawPath, endInk, extendInk, redrawLive, startInk, type Pt } from './ink/canvas.ts';

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
    bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) =>
      calls.push(`bezier ${c1x.toFixed(3)},${c1y.toFixed(3)} ${c2x.toFixed(3)},${c2y.toFixed(3)} ${x},${y}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y} r${r}`),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const wave: Pt[] = [{ x: 0, y: 0 }, { x: 12, y: 8 }, { x: 25, y: 11 }, { x: 40, y: 7 }, { x: 52, y: -2 }, { x: 60, y: -14 }];

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

test('the curve passes through every sample point exactly (no corner cutting)', () => {
  const { ctx, calls } = fakeCtx();
  drawPath(ctx, wave);
  const moves = calls.filter((c) => c.startsWith('move')).map((c) => c.slice(5));
  const ends = calls.filter((c) => c.startsWith('bezier')).map((c) => c.split(' ').pop());
  assert.deepEqual(moves, wave.slice(0, -1).map((p) => `${p.x},${p.y}`));
  assert.deepEqual(ends, wave.slice(1).map((p) => `${p.x},${p.y}`));
});

test('a sharp corner stays sharp: the handles at the corner point collapse onto it', () => {
  const { ctx, calls } = fakeCtx();
  drawPath(ctx, [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }]); // 90° 꺾임
  const beziers = calls.filter((c) => c.startsWith('bezier'));
  // 첫 구간의 두 번째 조절점과 둘째 구간의 첫 조절점이 꺾임 점(30,0) 자체다.
  assert.match(beziers[0], / 30\.000,0\.000 30,0$/);
  assert.match(beziers[1], /^bezier 30\.000,0\.000 /);
});

test('collinear points make a straight line (handles stay on the line)', () => {
  const { ctx, calls } = fakeCtx();
  drawPath(ctx, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]);
  for (const c of calls.filter((x) => x.startsWith('bezier'))) {
    const nums = c.replace('bezier ', '').split(/[ ,]/).map(Number);
    assert.equal(nums[1], 0);
    assert.equal(nums[3], 0);
  }
});

test('drawing live, point by point, gives exactly the same strokes as drawing the finished path', () => {
  const live = fakeCtx();
  let cursor = startInk(wave[0]);
  for (const p of wave.slice(1)) cursor = extendInk(live.ctx, cursor, p);
  endInk(live.ctx, cursor);
  const whole = fakeCtx();
  drawPath(whole.ctx, wave);
  assert.deepEqual(live.calls, whole.calls);
});

test('a repeated point does not change the drawing', () => {
  const withRepeats: Pt[] = [wave[0], wave[1], wave[1], wave[2], wave[3], wave[3], wave[4], wave[5]];
  const a = fakeCtx();
  drawPath(a.ctx, withRepeats);
  const b = fakeCtx();
  drawPath(b.ctx, wave);
  assert.deepEqual(a.calls, b.calls);
});

test('a tap (a single point) is drawn as a dot', () => {
  const { ctx, calls } = fakeCtx();
  endInk(ctx, startInk({ x: 7, y: 9 }));
  assert.deepEqual(calls, ['begin', 'arc 7,9 r2', 'fill']);
  const again = fakeCtx();
  drawPath(again.ctx, [{ x: 7, y: 9 }]);
  assert.deepEqual(again.calls, calls);
});

test('restoring a stroke in progress redraws exactly what was already drawn and drawing can continue seamlessly', () => {
  const first = fakeCtx();
  let live = startInk(wave[0]);
  for (const p of wave.slice(1, 4)) live = extendInk(first.ctx, live, p);
  const restored = fakeCtx();
  redrawLive(restored.ctx, live);
  assert.deepEqual(restored.calls, first.calls); // 지금까지 그린 구간이 같다
  // 이어서 그리면 처음부터 끊김 없이 그린 것과 같은 결과가 된다
  for (const p of wave.slice(4)) live = extendInk(restored.ctx, live, p);
  endInk(restored.ctx, live);
  const whole = fakeCtx();
  drawPath(whole.ctx, wave);
  assert.deepEqual(restored.calls, whole.calls);
});
