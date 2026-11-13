import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStroke, coverage, GESTURE, insidePolygon, pathLength, signedTurning, thin, type Target } from './ink/gesture.ts';
import type { Pt } from './ink/canvas.ts';

// 같은 줄에 나란한 상품 칸 둘(A, B)과 아래 줄의 칸(C). 칸 높이 30, 칸 사이 간격 20.
const A: Target = { id: 'A', left: 100, top: 100, width: 140, height: 30 };
const B: Target = { id: 'B', left: 260, top: 100, width: 140, height: 30 };
const C: Target = { id: 'C', left: 100, top: 140, width: 140, height: 30 };
const targets = [A, B, C];

// 타원을 turns 바퀴 도는 획
function ellipse(cx: number, cy: number, rx: number, ry: number, turns = 1.08, n = 40): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * turns * 2 * Math.PI;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}
function line(from: Pt, to: Pt, n = 10): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));
}

test('a circle around a product chip is recognised', () => {
  const r = classifyStroke(ellipse(170, 115, 100, 30), targets);
  assert.equal(r.kind, 'circle');
  assert.equal(r.kind === 'circle' && r.itemId, 'A');
});

test('a loop covering about half of the chip still counts (40% threshold)', () => {
  const r = classifyStroke(ellipse(170, 115, 40, 18), targets);
  assert.equal(r.kind, 'circle');
  assert.ok(r.kind === 'circle' && r.coverage >= GESTURE.circleMinCoverage && r.coverage < 0.9);
});

test('a loop that only covers the left 40% of the chip counts when it is the closest chip', () => {
  // A의 왼쪽 약 절반만 감싸는 원(중심이 A의 왼쪽 부분)
  const r = classifyStroke(ellipse(135, 115, 40, 20), targets);
  assert.equal(r.kind === 'circle' && r.itemId, 'A');
});

test('a small loop that covers well under 40% of the chip is ignored', () => {
  assert.deepEqual(classifyStroke(ellipse(170, 115, 25, 10), targets), { kind: 'none', reason: 'no-target' });
});

test('a circle around two chips is ambiguous and ignored', () => {
  assert.deepEqual(classifyStroke(ellipse(250, 115, 170, 30), targets), { kind: 'none', reason: 'ambiguous' });
});

test('a circle that only grazes the neighbour is assigned to the chip it is centred on', () => {
  const r = classifyStroke(ellipse(190, 115, 110, 28), targets);
  assert.equal(r.kind === 'circle' && r.itemId, 'A');
});

test('a tall circle that also covers over 40% of the chip in the next row still goes to the chip it is centred on', () => {
  // 사진의 상황: 칸이 위아래로 촘촘해서 큰 원이 아래 줄 칸 C도 40% 넘게 감싼다. 예전 규칙은 이것을 "애매함"으로 무시했다.
  const tall = ellipse(170, 115, 100, 44);
  assert.ok(coverage(C, tall) >= GESTURE.circleMinCoverage);
  const r = classifyStroke(tall, targets);
  assert.equal(r.kind === 'circle' && r.itemId, 'A');
});

test('a loop centred between two stacked chips is ambiguous', () => {
  assert.deepEqual(classifyStroke(ellipse(170, 135, 100, 36), targets), { kind: 'none', reason: 'ambiguous' });
});

test('a loop far bigger than the chip is rejected as too big', () => {
  assert.deepEqual(classifyStroke(ellipse(170, 115, 260, 40), [A]), { kind: 'none', reason: 'too-big' });
});

test('an open arc is not a circle', () => {
  assert.deepEqual(classifyStroke(ellipse(170, 115, 60, 60, 0.5), targets), { kind: 'none', reason: 'not-closed' });
});

test('going out and coming back is not a circle', () => {
  const points = [...line({ x: 100, y: 100 }, { x: 240, y: 100 }), ...line({ x: 240, y: 104 }, { x: 100, y: 104 })];
  assert.deepEqual(classifyStroke(points, targets), { kind: 'none', reason: 'not-enough-turn' });
});

test('a tap or a tiny scribble is too short', () => {
  assert.deepEqual(classifyStroke([{ x: 150, y: 110 }, { x: 151, y: 111 }], targets), { kind: 'none', reason: 'too-short' });
  assert.deepEqual(classifyStroke(line({ x: 150, y: 110 }, { x: 160, y: 118 }), targets), { kind: 'none', reason: 'too-short' });
});

test('a straight stroke across more than half of a chip is recognised in any direction', () => {
  const diagonal = classifyStroke(line({ x: 150, y: 135 }, { x: 190, y: 95 }), targets);
  assert.equal(diagonal.kind === 'line' && diagonal.itemId, 'A');
  const backslash = classifyStroke(line({ x: 150, y: 95 }, { x: 190, y: 135 }), targets);
  assert.equal(backslash.kind === 'line' && backslash.itemId, 'A');
  const horizontal = classifyStroke(line({ x: 90, y: 115 }, { x: 250, y: 117 }), targets);
  assert.equal(horizontal.kind === 'line' && horizontal.itemId, 'A');
  const vertical = classifyStroke(line({ x: 170, y: 95 }, { x: 172, y: 135 }), targets);
  assert.equal(vertical.kind === 'line' && vertical.itemId, 'A');
});

test('a short vertical stroke still counts when it spans most of the chip height', () => {
  const r = classifyStroke(line({ x: 170, y: 104 }, { x: 170, y: 130 }), targets);
  assert.equal(r.kind === 'line' && r.itemId, 'A');
});

test('a horizontal stroke over about 40% of the chip width does not count (needs 50%)', () => {
  assert.deepEqual(classifyStroke(line({ x: 140, y: 115 }, { x: 196, y: 115 }), targets), { kind: 'none', reason: 'no-target' });
});

test('a slightly wavy stroke across a chip still counts as straight', () => {
  const wavy = line({ x: 100, y: 115 }, { x: 240, y: 115 }, 14).map((p, i) => ({ x: p.x, y: p.y + (i % 2 === 0 ? 2 : -2) }));
  const r = classifyStroke(wavy, targets);
  assert.equal(r.kind === 'line' && r.itemId, 'A');
});

test('an underline below the chip does not count', () => {
  assert.deepEqual(classifyStroke(line({ x: 100, y: 133 }, { x: 240, y: 135 }), targets), { kind: 'none', reason: 'no-target' });
});

test('a long steep stroke across two rows belongs to neither chip', () => {
  assert.deepEqual(classifyStroke(line({ x: 150, y: 95 }, { x: 190, y: 175 }), targets), { kind: 'none', reason: 'no-target' });
});

test('a stroke over empty space is ignored', () => {
  assert.deepEqual(classifyStroke(line({ x: 500, y: 300 }, { x: 540, y: 340 }), targets), { kind: 'none', reason: 'no-target' });
});

test('a long line that covers one chip fully and only grazes the next goes to the first', () => {
  const r = classifyStroke(line({ x: 90, y: 115 }, { x: 330, y: 115 }), targets);
  assert.equal(r.kind === 'line' && r.itemId, 'A');
});

test('geometry helpers', () => {
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]), 11);
  assert.ok(insidePolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  assert.ok(!insidePolygon({ x: 15, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  assert.equal(coverage(A, [{ x: 90, y: 90 }, { x: 250, y: 90 }, { x: 250, y: 140 }, { x: 90, y: 140 }]), 1);
  assert.equal(coverage(A, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 0);
  assert.ok(Math.abs(signedTurning(ellipse(0, 0, 10, 10, 1, 40))) > 1.8 * Math.PI);
  assert.equal(thin([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 }, { x: 6, y: 0 }], 3).length, 3);
});
