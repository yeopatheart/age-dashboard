import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorLegacyStrokes, pickRowAnchor, rowAnchor } from './ink/row-anchor.ts';
import {
  chipTargets,
  isProductAnchor,
  isSumAnchor,
  pickSumAnchor,
  sumAnchor,
  sumKeyOf,
  SUM_ANCHOR_TOLERANCE_PX,
  SUM_KEY_MAX_LENGTH,
} from './ink/summary-anchor.ts';
import { parseInkStrokes, resolvePoints, toAnchoredStroke, toFreeStroke, toPieceStroke, type Box, type InkStroke } from './ink/store.ts';
import { eraseStroke } from './ink/erase.ts';
import type { Pt } from './ink/canvas.ts';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });
const boxesOf = (entries: Record<string, Box>) => new Map(Object.entries(entries));
const BASE = { id: 's1', color: '#dc2626', width: 4 };
const layer = { width: 1248, height: 696 };
const line = (...xy: number[]): Pt[] => xy.reduce<Pt[]>((acc, v, i) => (i % 2 === 0 ? [...acc, { x: v, y: xy[i + 1] }] : acc), []);

// ── anchor 형식 ─────────────────────────────────────────────────────────────
test('sumAnchor / isSumAnchor / sumKeyOf round trip, including keys with |, :, Korean and spaces', () => {
  for (const key of ['보리새우|선별|kg|none', 'a:b|c:d|미|aerator', 'sum:nested|6-800|kg|mulbong', '3f2b8a52-0c1e-4c1b-9a43-1d2f7a8e9b10|| |none', '']) {
    const a = sumAnchor(key);
    assert.equal(isSumAnchor(a), true);
    assert.equal(sumKeyOf(a), key);
  }
});

test('sum anchors never collide with product (UUID) anchors or row anchors', () => {
  assert.equal(isSumAnchor('3f2b8a52-0c1e-4c1b-9a43-1d2f7a8e9b10'), false);
  assert.equal(isSumAnchor(rowAnchor('biz-1')), false);
  assert.equal(isSumAnchor(undefined), false);
  assert.equal(isProductAnchor('3f2b8a52-0c1e-4c1b-9a43-1d2f7a8e9b10'), true);
  assert.equal(isProductAnchor(rowAnchor('biz-1')), false);
  assert.equal(isProductAnchor(sumAnchor('x|y|kg|none')), false);
  assert.equal(isProductAnchor(undefined), false);
});

// ── 판정 ───────────────────────────────────────────────────────────────────
const PANEL = boxesOf({
  [sumAnchor('A|s|kg|none')]: box(1040, 100, 100, 25),
  [sumAnchor('B|s|kg|none')]: box(1144, 100, 100, 25),
  [sumAnchor('C|s|kg|none')]: box(1040, 126, 204, 25),
});

test('pickSumAnchor: the chip containing the mean position wins', () => {
  assert.equal(pickSumAnchor(line(1050, 105, 1100, 118), PANEL), sumAnchor('A|s|kg|none'));
  assert.equal(pickSumAnchor(line(1150, 105, 1230, 118), PANEL), sumAnchor('B|s|kg|none'));
});

test('pickSumAnchor: a stroke that starts in one chip but whose mean is in another belongs to the mean chip', () => {
  assert.equal(pickSumAnchor(line(1050, 105, 1100, 140, 1200, 140), PANEL), sumAnchor('C|s|kg|none'));
});

test('pickSumAnchor: when the mean falls outside every chip, the chip the stroke started in wins', () => {
  // 평균이 패널 아래 빈 곳(y=300)이지만 시작점은 A 칩 안
  const pts = line(1060, 110, 1060, 500);
  assert.equal(pickSumAnchor(pts, PANEL), sumAnchor('A|s|kg|none'));
});

test('pickSumAnchor: start point tolerance covers the 4px gap between chips but nothing farther', () => {
  assert.equal(SUM_ANCHOR_TOLERANCE_PX, 4);
  // A는 1040..1140, B는 1144..1244. 평균은 빈 곳(y=500)에 두고 시작점만 본다.
  const gapStart = (x: number, y: number) => pickSumAnchor(line(x, y, x, 700), PANEL);
  assert.equal(gapStart(1141, 112), sumAnchor('A|s|kg|none')); // 틈 안, A에서 1px
  assert.equal(gapStart(1143, 112), sumAnchor('B|s|kg|none')); // 틈 안, B에서 1px
  assert.equal(gapStart(1036, 112), sumAnchor('A|s|kg|none')); // A 왼쪽 가장자리에서 4px 밖(경계 포함)
  assert.equal(gapStart(1035, 112), null); // 5px 밖
  assert.equal(gapStart(1100, 96), sumAnchor('A|s|kg|none')); // 위쪽 4px 밖
  assert.equal(gapStart(1100, 95), null);
  assert.equal(pickSumAnchor(line(1100, 300, 1100, 310), PANEL), null); // 패널 아래 빈 곳은 낙서
});

test('pickSumAnchor: ties between candidate chips resolve by distance, then by center, then first', () => {
  const two = boxesOf({ [sumAnchor('L')]: box(0, 0, 100, 20), [sumAnchor('R')]: box(104, 0, 100, 20) });
  // 시작점이 틈의 한가운데(102)에서 양쪽 2px → 중심이 가까운 쪽(둘 다 같으면 먼저 나온 L)
  assert.equal(pickSumAnchor(line(102, 10, 102, 400), two), sumAnchor('L'));
  assert.equal(pickSumAnchor(line(103, 10, 103, 400), two), sumAnchor('R'));
  assert.equal(pickSumAnchor(line(101, 10, 101, 400), two), sumAnchor('L'));
});

test('pickSumAnchor: ignores product-cell boxes and row boxes, and an empty stroke', () => {
  const mixed = boxesOf({ 'cell-uuid': box(0, 0, 500, 40), [rowAnchor('biz-1')]: box(0, 0, 900, 40), [sumAnchor('A|s|kg|none')]: box(1040, 100, 100, 25) });
  assert.equal(pickSumAnchor(line(10, 10, 20, 20), mixed), null);
  assert.equal(pickSumAnchor([], mixed), null);
});

test('pickSumAnchor: a chip whose key is longer than the limit is never chosen (the stroke stays a free drawing)', () => {
  const long = 'x'.repeat(SUM_KEY_MAX_LENGTH + 1);
  const ok = 'x'.repeat(SUM_KEY_MAX_LENGTH);
  assert.equal(pickSumAnchor(line(10, 10, 30, 20), boxesOf({ [sumAnchor(long)]: box(0, 0, 100, 40) })), null);
  assert.equal(pickSumAnchor(line(10, 10, 30, 20), boxesOf({ [sumAnchor(ok)]: box(0, 0, 100, 40) })), sumAnchor(ok));
});

test('chipTargets keeps only product cells: row and summary-chip boxes are not gesture targets', () => {
  const targets = chipTargets(boxesOf({ 'cell-1': box(1, 2, 3, 4), [rowAnchor('biz-1')]: box(0, 0, 9, 9), [sumAnchor('A|s|kg|none')]: box(5, 5, 5, 5), 'cell-2': box(6, 7, 8, 9) }));
  assert.deepEqual(targets, [{ id: 'cell-1', left: 1, top: 2, width: 3, height: 4 }, { id: 'cell-2', left: 6, top: 7, width: 8, height: 9 }]);
});

// ── 칩이 움직이면 필기가 따라간다 ───────────────────────────────────────────────
const KEY = sumAnchor('보리새우|선별|kg|none');
const written = line(1060, 105, 1075, 112, 1100, 108);
const writtenBox = box(1040, 100, 120, 24);
const stored = toAnchoredStroke(BASE, written, KEY, writtenBox);

// 칩 안에서 같은 위치(칩 왼쪽 위 기준 비율)에 그려져야 한다.
const relative = (pts: Pt[] | null, b: Box) => pts?.map((p) => [Math.round(((p.x - b.left) / b.width) * 1e3) / 1e3, Math.round(((p.y - b.top) / b.height) * 1e3) / 1e3]);

test('a stroke written on a chip is stored relative to that chip and comes back at the same relative spot after the chip grows down, moves, reorders or shrinks', () => {
  const original = relative(resolvePoints(stored, layer, writtenBox), writtenBox);
  const cases: Box[] = [
    box(1040, 100, 120, 24), // 그대로
    box(1040, 126, 120, 24), // 수량이 늘어 앞 칩이 줄을 차지해 아래로 밀림
    box(1144, 100, 100, 24), // 순서가 바뀌어 같은 줄 오른쪽 칸으로
    box(1040, 100, 204, 24), // 폭이 늘어 한 줄을 다 씀
    box(1040, 52, 150, 16), // 글자 단계가 줄어 높이가 낮아지고 위로 올라옴
  ];
  for (const b of cases) {
    const pts = resolvePoints(stored, layer, b);
    assert.deepEqual(relative(pts, b), original);
    assert.ok(pts && pts.every((p) => p.x >= b.left - 1e-6 && p.x <= b.left + b.width + 1e-6 && p.y >= b.top - 1e-6 && p.y <= b.top + b.height + 1e-6));
  }
  // 위치가 실제로 칩을 따라갔다
  const moved = resolvePoints(stored, layer, box(1040, 226, 120, 24));
  assert.equal(moved?.[0].y !== resolvePoints(stored, layer, writtenBox)?.[0].y, true);
});

test('a stroke on a chip that is not on screen is not drawn and not lost (resolvePoints returns null; the stored stroke is untouched)', () => {
  assert.equal(resolvePoints(stored, layer, null), null);
  assert.equal(resolvePoints(stored, layer, undefined), null);
  const roundTrip = parseInkStrokes(JSON.parse(JSON.stringify([stored])));
  assert.deepEqual(roundTrip, [stored]);
  assert.equal(roundTrip[0].anchor, KEY);
});

test('sum strokes survive parseInkStrokes unchanged (anchor kept, no lay)', () => {
  const [s] = parseInkStrokes(JSON.parse(JSON.stringify([stored])));
  assert.equal(s.anchor, KEY);
  assert.equal('lay' in s, false);
  assert.deepEqual(s, stored);
});

test('eraser pieces of a sum stroke inherit the sum anchor and stay on the same chip', () => {
  const shown = stored;
  const pts = resolvePoints(shown, layer, writtenBox)!;
  const result = eraseStroke(pts, pts[1], 3);
  assert.equal(result.changed, true);
  assert.ok(result.pieces.length >= 1);
  for (const piece of result.pieces) {
    const next = toPieceStroke({ id: 'p', color: shown.color, width: shown.width }, piece, shown, writtenBox, layer);
    assert.equal(next.anchor, KEY);
    assert.equal('lay' in next, false);
    // 조각도 칩이 움직이면 따라간다
    const after = resolvePoints(next, layer, box(1144, 226, 100, 24));
    assert.ok(after && after.every((p) => p.x >= 1144 - 1e-6 && p.x <= 1244 + 1e-6 && p.y >= 226 - 1e-6 && p.y <= 250 + 1e-6));
  }
});

// ── 기존 필기는 그대로 ──────────────────────────────────────────────────────────
test('legacy free strokes drawn on the panel stay free: anchorLegacyStrokes only knows rows', () => {
  const free: InkStroke = toFreeStroke({ id: 'f', color: '#2563eb', width: 3.5 }, line(1060, 105, 1100, 118), layer);
  const boxes = boxesOf({ [rowAnchor('biz-1')]: box(0, 0, 1000, 40), ...Object.fromEntries(PANEL) });
  const out = anchorLegacyStrokes([free], layer, boxes);
  assert.equal(out[0], free);
  assert.equal(out[0].anchor, undefined);
  // 그리는 순서(칩 → 줄)에서도 줄 판정은 sum 칩을 줄로 오인하지 않는다
  assert.equal(pickRowAnchor(line(1060, 105, 1100, 118), boxes), null);
});

test('golden: strokes without sum anchors (free, row, product cell) serialize and resolve exactly as before', () => {
  const raw = [
    { id: 'r1', color: '#dc2626', width: 4, pts: [0.1234, 0.5, 0.2, 0.55, 0.31, 0.6], anchor: 'row:biz-1' },
    { id: 'f1', color: '#2563eb', width: 3.5, pts: [0.01, 0.02, 0.5, 0.25, 0.99, 0.8] },
    { id: 'c1', color: '#111827', width: 6, pts: [0.2, 0.3, 0.8, 0.3, 1.2, -0.1], anchor: '3f2b8a52-0c1e-4c1b-9a43-1d2f7a8e9b10' },
  ];
  const parsed = parseInkStrokes(JSON.parse(JSON.stringify(raw)));
  assert.equal(JSON.stringify(parsed), JSON.stringify(raw));
  const lay = { width: 1920, height: 1080 };
  const b = box(100.5, 200.25, 1248, 62);
  assert.equal(
    JSON.stringify(parsed.map((s) => resolvePoints(s, lay, s.anchor === undefined ? undefined : b))),
    '[[{"x":254.5032,"y":231.25},{"x":350.1,"y":234.35},{"x":487.38,"y":237.45}],[{"x":19.2,"y":21.6},{"x":960,"y":270},{"x":1900.8,"y":864}],[{"x":350.1,"y":218.85},{"x":1098.9,"y":218.85},{"x":1598.1,"y":194.05}]]',
  );
});
