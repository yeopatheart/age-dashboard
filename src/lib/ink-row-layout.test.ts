import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorLegacyStrokes } from './ink/row-anchor.ts';
import {
  parseInkStrokes,
  parseRowLayout,
  remapStroke,
  remapX,
  resolvePoints,
  rowLayoutFrom,
  toAnchoredStroke,
  toPieceStroke,
  type Box,
  type RowLayout,
} from './ink/store.ts';

// ── 골든: lay 없는 옛 저장본은 이 변경 전과 바이트 단위로 같아야 한다(값은 변경 전 코드에서 뽑아 고정) ─────────────────────────────
const GOLDEN_RAW = [
  { id: 'r1', color: '#dc2626', width: 4, pts: [0.1234, 0.5, 0.2, 0.55, 0.31, 0.6], anchor: 'row:biz-1' },
  { id: 'f1', color: '#2563eb', width: 3.5, pts: [0.01, 0.02, 0.5, 0.25, 0.99, 0.8] },
  { id: 'c1', color: '#111827', width: 6, pts: [0.2, 0.3, 0.8, 0.3, 1.2, -0.1], anchor: '3f2b8a52-0c1e-4c1b-9a43-1d2f7a8e9b10' },
  { id: 'bad', color: 'red', width: 4, pts: [0, 0, 1, 1] },
];
const GOLDEN_PARSED_JSON =
  '[{"id":"r1","color":"#dc2626","width":4,"pts":[0.1234,0.5,0.2,0.55,0.31,0.6],"anchor":"row:biz-1"},{"id":"f1","color":"#2563eb","width":3.5,"pts":[0.01,0.02,0.5,0.25,0.99,0.8]},{"id":"c1","color":"#111827","width":6,"pts":[0.2,0.3,0.8,0.3,1.2,-0.1],"anchor":"3f2b8a52-0c1e-4c1b-9a43-1d2f7a8e9b10"}]';
const GOLDEN_RESOLVED_JSON =
  '[[{"x":254.5032,"y":231.25},{"x":350.1,"y":234.35},{"x":487.38,"y":237.45}],[{"x":19.2,"y":21.6},{"x":960,"y":270},{"x":1900.8,"y":864}],[{"x":350.1,"y":218.85},{"x":1098.9,"y":218.85},{"x":1598.1,"y":194.05}]]';

test('golden: strokes without lay parse to the exact same JSON and resolve to the exact same points as before', () => {
  const parsed = parseInkStrokes(JSON.parse(JSON.stringify(GOLDEN_RAW)));
  assert.equal(JSON.stringify(parsed), GOLDEN_PARSED_JSON);
  const layer = { width: 1920, height: 1080 };
  const box = { left: 100.5, top: 200.25, width: 1248, height: 62 };
  assert.equal(JSON.stringify(parsed.map((s) => resolvePoints(s, layer, s.anchor === undefined ? undefined : box))), GOLDEN_RESOLVED_JSON);
});

test('golden: remapStroke is a no-op (same object) for strokes without lay, whatever the current layout is', () => {
  const parsed = parseInkStrokes(JSON.parse(JSON.stringify(GOLDEN_RAW)));
  const cur: RowLayout = { w: 1000, t: [40, 64, 144, 64, 100, 100] };
  for (const s of parsed) {
    assert.equal(remapStroke(s, cur), s);
    assert.equal(remapStroke(s, null), s);
  }
});

test('golden: toAnchoredStroke without lay has no lay key and the same shape as before', () => {
  const s = toAnchoredStroke({ id: 'a', color: '#dc2626', width: 4 }, [{ x: 10, y: 5 }, { x: 20, y: 10 }], 'row:x', { left: 0, top: 0, width: 100, height: 50 });
  assert.equal(JSON.stringify(s), '{"id":"a","color":"#dc2626","width":4,"anchor":"row:x","pts":[0.1,0.1,0.2,0.2]}');
  assert.equal('lay' in s, false);
});

test('golden: anchorLegacyStrokes output carries no lay', () => {
  const boxes = new Map<string, Box>([['row:r', { left: 0, top: 0, width: 1000, height: 100 }]]);
  const out = anchorLegacyStrokes(parseInkStrokes([{ id: 'x', color: '#dc2626', width: 4, pts: [0.1, 0.1, 0.2, 0.2] }]), { width: 1000, height: 100 }, boxes);
  assert.equal(out[0].anchor, 'row:r');
  assert.equal('lay' in out[0], false);
});

// ── 레이아웃 ─────────────────────────────────────────────────────────────────
// 고정 열 4개(40, 터미널 64, 고객명 144, 박스 64) + 카드 열 N개.
const board: RowLayout = { w: 1800, t: [40, 64, 144, 64, 200, 200, 200, 200, 200, 200] }; // 합 1312, 오른쪽 빈 자리 488
const pc: RowLayout = { w: 1248, t: [40, 64, 144, 64, 140, 140, 140, 140, 140, 140] }; // 합 1048

const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
const cum = (t: number[], i: number) => sum(t.slice(0, i));

test('remapX: identical layout is the identity', () => {
  for (const u of [-0.05, 0, 0.1, 0.33, 0.5, 0.74, 0.99, 1, 1.02]) assert.equal(remapX(u, board, board.t, board.w), u);
});

test('remapX: a mark inside a product column stays inside the same column at the same position (photo case)', () => {
  // 칠판에서 카드 열 3번째(i=6) 한가운데보다 왼쪽에 쓴 숫자.
  const f = 0.3;
  const x = cum(board.t, 6) + f * board.t[6];
  const u2 = remapX(x / board.w, board, pc.t, pc.w);
  const x2 = u2 * pc.w;
  assert.ok(x2 >= cum(pc.t, 6) && x2 < cum(pc.t, 7), 'same column');
  assert.ok(Math.abs((x2 - cum(pc.t, 6)) / pc.t[6] - f) < 1e-9, 'same position inside the column');
  // 변환 전 비율 그대로였다면 다른 칸에 떨어졌다(이 시나리오에서 칠판 비율을 PC 폭에 그대로 쓰면).
  const naive = (x / board.w) * pc.w;
  assert.ok(!(naive >= cum(pc.t, 6) && naive < cum(pc.t, 7)));
});

test('remapX: works in both directions and round-trips inside the grid', () => {
  for (let i = 0; i < 10; i++) {
    for (const f of [0, 0.25, 0.5, 0.999]) {
      const x = cum(pc.t, i) + f * pc.t[i];
      const there = remapX(x / pc.w, pc, board.t, board.w);
      const back = remapX(there, board, pc.t, pc.w);
      assert.ok(Math.abs(back * pc.w - x) < 1e-6);
    }
  }
});

test('remapX: fixed columns map track by track, and a slot boundary goes to the next track', () => {
  // 고정 열은 폭이 같으니 px 위치가 그대로다.
  const uName = remapX((cum(board.t, 2) + 10) / board.w, board, pc.t, pc.w);
  assert.ok(Math.abs(uName * pc.w - (cum(pc.t, 2) + 10)) < 1e-9);
  // 첫 카드 열의 왼쪽 경계(x = 312)는 첫 카드 열의 왼쪽 경계에 놓인다.
  const edge = remapX(312 / board.w, board, pc.t, pc.w) * pc.w;
  assert.ok(Math.abs(edge - 312) < 1e-9);
  // 둘째 카드 열의 왼쪽 경계: 칠판 512 → PC 452.
  const second = remapX(512 / board.w, board, pc.t, pc.w) * pc.w;
  assert.ok(Math.abs(second - 452) < 1e-9);
});

test('remapX: right of the last track keeps its distance from the track end; x < 0 keeps its pixel offset', () => {
  const S1 = sum(board.t);
  const S2 = sum(pc.t);
  const out = remapX((S1 + 50) / board.w, board, pc.t, pc.w) * pc.w;
  assert.ok(Math.abs(out - (S2 + 50)) < 1e-9);
  const left = remapX(-20 / board.w, board, pc.t, pc.w) * pc.w;
  assert.ok(Math.abs(left - -20) < 1e-9);
});

test('remapX: the result is clamped to the row width plus a margin', () => {
  const far = remapX(5, board, pc.t, pc.w); // 칠판 폭의 5배 오른쪽
  assert.equal(far * pc.w, pc.w * 1.5);
  const farLeft = remapX(-5, board, pc.t, pc.w);
  assert.equal(farLeft * pc.w, -pc.w * 0.5);
});

test('remapX: falls back to the original ratio when the layout cannot be trusted', () => {
  const u = 0.4321;
  assert.equal(remapX(u, board, pc.t.slice(0, 9), pc.w), u, 'track count changed');
  assert.equal(remapX(u, board, [...pc.t.slice(0, 5), 0, ...pc.t.slice(6)], pc.w), u, 'zero track');
  assert.equal(remapX(u, board, [...pc.t.slice(0, 5), NaN, ...pc.t.slice(6)], pc.w), u, 'NaN track');
  assert.equal(remapX(u, board, pc.t, 0), u, 'zero width');
  assert.equal(remapX(u, board, pc.t, NaN), u, 'NaN width');
  assert.equal(remapX(u, { w: 0, t: board.t }, pc.t, pc.w), u, 'broken stored width');
  assert.equal(remapX(NaN, board, pc.t, pc.w), NaN, 'NaN input is passed through untouched');
});

// ── remapStroke ─────────────────────────────────────────────────────────────
test('remapStroke: remaps x only, leaves y/id/color/width/anchor, and takes the current layout as the new lay', () => {
  const stroke = { id: 's', color: '#dc2626', width: 4, anchor: 'row:a', pts: [0.3, 0.2, 0.31, 0.7], lay: board };
  const out = remapStroke(stroke, pc);
  assert.notEqual(out, stroke);
  assert.deepEqual([out.pts[1], out.pts[3]], [0.2, 0.7]);
  assert.deepEqual(out.lay, pc);
  assert.equal(out.id, 's');
  assert.equal(out.anchor, 'row:a');
  assert.equal(stroke.lay, board, 'the source stroke is not mutated');
  assert.equal(stroke.pts[0], 0.3);
});

test('remapStroke: same layout returns the same object; fallback keeps the stored lay and ratio', () => {
  const stroke = { id: 's', color: '#dc2626', width: 4, anchor: 'row:a', pts: [0.3, 0.2, 0.31, 0.7], lay: board };
  assert.equal(remapStroke(stroke, { w: board.w, t: [...board.t] }), stroke);
  assert.equal(remapStroke(stroke, null), stroke);
  assert.equal(remapStroke(stroke, undefined), stroke);
  assert.equal(remapStroke(stroke, { w: 1200, t: pc.t.slice(0, 8) }), stroke);
});

// ── 지우개 조각 ─────────────────────────────────────────────────────────────
test('toPieceStroke: pieces of a remapped stroke keep a lay (the current one), pieces of a fallback stroke inherit the stored one, strokes without lay stay without', () => {
  const box: Box = { left: 10, top: 20, width: 1248, height: 60 };
  const layer = { width: 1920, height: 1080 };
  const base = { id: 'p', color: '#dc2626', width: 4 };
  const piece = [{ x: 400, y: 40 }, { x: 420, y: 45 }];
  const stroke = { id: 's', color: '#dc2626', width: 4, anchor: 'row:a', pts: [0.3, 0.2, 0.31, 0.7], lay: board };

  const remapped = toPieceStroke(base, piece, remapStroke(stroke, pc), box, layer);
  assert.deepEqual(remapped.lay, pc);
  assert.equal(remapped.anchor, 'row:a');
  // 조각을 다시 같은 화면에 그리면 조각의 점이 그대로 나온다(지운 뒤에 조각이 움직이지 않는다).
  const shown = remapStroke(remapped, pc);
  assert.equal(shown, remapped);
  const back = resolvePoints(shown, layer, box);
  assert.ok(back && Math.abs(back[0].x - 400) < 0.1 && Math.abs(back[1].y - 45) < 0.1);

  const fallback = toPieceStroke(base, piece, remapStroke(stroke, null), box, layer);
  assert.deepEqual(fallback.lay, board);

  const plain = toPieceStroke(base, piece, { id: 's', color: '#dc2626', width: 4, anchor: 'row:a', pts: [0.3, 0.2, 0.31, 0.7] }, box, layer);
  assert.equal('lay' in plain, false);

  const free = toPieceStroke(base, piece, { id: 's', color: '#dc2626', width: 4, pts: [0.3, 0.2, 0.31, 0.7] }, null, layer);
  assert.equal(free.anchor, undefined);
  assert.equal('lay' in free, false);
});

// ── parseInkStrokes ─────────────────────────────────────────────────────────
const strokeWith = (lay: unknown) => ({ id: 's', color: '#dc2626', width: 4, pts: [0.1, 0.2, 0.3, 0.4], anchor: 'row:a', lay });

test('parseInkStrokes keeps a valid lay and survives a JSON round trip', () => {
  const parsed = parseInkStrokes([strokeWith({ w: 1800, t: [40, 64, 144, 64, 200] })]);
  assert.deepEqual(parsed[0].lay, { w: 1800, t: [40, 64, 144, 64, 200] });
  assert.deepEqual(parseInkStrokes(JSON.parse(JSON.stringify(parsed))), parsed);
});

test('parseInkStrokes drops a corrupt lay but keeps the stroke untouched', () => {
  const bad: unknown[] = [
    null,
    'x',
    [],
    {},
    { w: 0, t: [1] },
    { w: -5, t: [1] },
    { w: NaN, t: [1] },
    { w: 100, t: [] },
    { w: 100, t: 'abc' },
    { w: 100, t: [10, -1] },
    { w: 100, t: [10, NaN] },
    { w: 100, t: [10, '5'] },
    { w: 100, t: [60, 60] }, // 합 120 > w+1
    { w: 100, t: Array.from({ length: 65 }, () => 1) },
    { t: [1] },
    { w: 100 },
  ];
  for (const lay of bad) {
    const parsed = parseInkStrokes([strokeWith(lay)]);
    assert.equal(parsed.length, 1, JSON.stringify(lay));
    assert.equal('lay' in parsed[0], false, JSON.stringify(lay));
    assert.equal(JSON.stringify(parsed[0]), '{"id":"s","color":"#dc2626","width":4,"pts":[0.1,0.2,0.3,0.4],"anchor":"row:a"}');
  }
});

test('parseInkStrokes accepts a track sum up to w + 1 and copies only w and t', () => {
  assert.equal(parseInkStrokes([strokeWith({ w: 100, t: [50, 51] })])[0].lay?.t.length, 2);
  const parsed = parseInkStrokes([strokeWith({ w: 100, t: [50, 20], junk: 'x' })]);
  assert.deepEqual(Object.keys(parsed[0].lay ?? {}).sort(), ['t', 'w']);
  assert.deepEqual(parseRowLayout({ w: 100, t: [50, 20] }), { w: 100, t: [50, 20] });
  assert.equal(parseRowLayout(undefined), undefined);
});

test('parseInkStrokes: strokes without lay serialise with no lay key in the same key order as before', () => {
  const parsed = parseInkStrokes([{ id: 'a', color: '#dc2626', width: 4, pts: [0, 0, 1, 1], anchor: 'row:z' }]);
  assert.deepEqual(Object.keys(parsed[0]), ['id', 'color', 'width', 'pts', 'anchor']);
});

// ── 측정 문자열 파싱(DOM 없이) ───────────────────────────────────────────────
test('rowLayoutFrom parses a computed grid-template-columns and validates it against the row width', () => {
  assert.deepEqual(rowLayoutFrom('40px 64px 144px 64px 200px 200px', 1000), { w: 1000, t: [40, 64, 144, 64, 200, 200] });
  assert.deepEqual(rowLayoutFrom('40px 64px 143.5px 64px 199.984px', 600), { w: 600, t: [40, 64, 143.5, 64, 199.98] });
  assert.equal(rowLayoutFrom('', 1000), null);
  assert.equal(rowLayoutFrom('none', 1000), null);
  assert.equal(rowLayoutFrom('40px auto 64px', 1000), null);
  assert.equal(rowLayoutFrom('[a] 40px 64px', 1000), null);
  assert.equal(rowLayoutFrom('40px 0px 64px', 1000), null, 'zero track');
  assert.equal(rowLayoutFrom('40px NaNpx', 1000), null);
  assert.equal(rowLayoutFrom('40px 64px', 0), null);
  assert.equal(rowLayoutFrom('40px 64px', NaN), null);
  assert.equal(rowLayoutFrom('600px 600px', 1000), null, 'tracks wider than the row');
  assert.ok(rowLayoutFrom('500px 501px', 1000), 'within one pixel of the row width is fine');
  assert.equal(rowLayoutFrom(Array.from({ length: 65 }, () => '1px').join(' '), 1000), null, 'too many tracks');
});
