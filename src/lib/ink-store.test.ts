import test from 'node:test';
import assert from 'node:assert/strict';
import { densify, eraseStroke, splitByMask } from './ink/erase.ts';
import { HISTORY_LIMIT, popHistory, pushHistory, type HistoryEntry } from './ink/history.ts';
import { inkKey, MAX_POINTS, MAX_STROKES, parseInk, pruneInk, resolvePoints, serializeInk, thinForStorage, toAnchoredStroke, toFreeStroke, type InkStroke } from './ink/store.ts';
import type { Pt } from './ink/canvas.ts';

const base = { id: 's1', color: '#dc2626', width: 4 };
const pts: Pt[] = [{ x: 100, y: 50 }, { x: 140, y: 70 }, { x: 200, y: 120 }, { x: 260, y: 90 }];

test('erasing removes the part inside the eraser even when the touch samples are sparse', () => {
  // 두 점뿐인 가로선의 한가운데를 지운다: 점은 하나도 원 안에 없지만 선은 끊겨야 한다.
  const result = eraseStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 50, y: 0 }, 10);
  assert.equal(result.changed, true);
  assert.equal(result.pieces.length, 2);
  assert.ok(result.pieces[0].every((p) => p.x < 40.5));
  assert.ok(result.pieces[1].every((p) => p.x > 59.5));
});

test('a stroke the eraser does not touch is returned unchanged', () => {
  const stroke = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const result = eraseStroke(stroke, { x: 50, y: 80 }, 10);
  assert.deepEqual(result, { changed: false, pieces: [stroke] });
});

test('erasing the whole stroke leaves nothing, and single leftover points are dropped', () => {
  assert.deepEqual(eraseStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 5, y: 0 }, 50).pieces, []);
  assert.deepEqual(splitByMask([1, 2, 3, 4, 5], [false, true, false, false, true]), [[3, 4]]);
});

test('densify keeps the end points and never leaves a gap larger than the step', () => {
  const dense = densify([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
  assert.equal(dense.length, 11);
  assert.deepEqual([dense[0], dense[10]], [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});

test('undo history keeps the last 30 steps and pops the newest first', () => {
  let history: HistoryEntry<number>[] = [];
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) history = pushHistory(history, { before: i });
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].before, 5);
  const popped = popHistory(history);
  assert.equal(popped.entry?.before, HISTORY_LIMIT + 4);
  assert.equal(popped.rest.length, HISTORY_LIMIT - 1);
  assert.deepEqual(popHistory([]), { entry: null, rest: [] });
});

test('a history entry remembers which chip the stroke packed', () => {
  const history = pushHistory([], { before: 'strokes-before', packedItemId: 'item-1' });
  assert.equal(popHistory(history).entry?.packedItemId, 'item-1');
});

test('a free stroke is stored relative to the layer and comes back at any layer size', () => {
  const stroke = toFreeStroke(base, pts, { width: 1000, height: 500 });
  assert.equal(stroke.anchor, undefined);
  const back = resolvePoints(stroke, { width: 1000, height: 500 });
  assert.deepEqual(back, pts);
  const scaled = resolvePoints(stroke, { width: 500, height: 250 });
  assert.deepEqual(scaled?.[0], { x: 50, y: 25 });
});

test('an anchored stroke follows its chip when the chip moves or resizes', () => {
  const box = { left: 100, top: 40, width: 200, height: 40 };
  const stroke = toAnchoredStroke(base, pts, 'item-1', box);
  assert.equal(stroke.anchor, 'item-1');
  assert.deepEqual(resolvePoints(stroke, { width: 1000, height: 500 }, box), pts);
  const moved = resolvePoints(stroke, { width: 1000, height: 500 }, { left: 300, top: 200, width: 100, height: 20 });
  assert.deepEqual(moved?.[0], { x: 300, y: 200 + 10 * 0.5 });
});

test('an anchored stroke whose chip is not on screen is not drawn but is kept', () => {
  const stroke = toAnchoredStroke(base, pts, 'item-1', { left: 0, top: 0, width: 10, height: 10 });
  assert.equal(resolvePoints(stroke, { width: 100, height: 100 }, null), null);
  assert.equal(parseInk(serializeInk([stroke])).length, 1);
});

test('strokes survive a save and load round trip', () => {
  const strokes = [toFreeStroke(base, pts, { width: 1000, height: 500 }), toAnchoredStroke({ ...base, id: 's2' }, pts, 'item-9', { left: 10, top: 10, width: 100, height: 30 })];
  assert.deepEqual(parseInk(serializeInk(strokes)), strokes);
});

test('broken or hostile saved data is dropped instead of crashing', () => {
  assert.deepEqual(parseInk(null), []);
  assert.deepEqual(parseInk('not json'), []);
  assert.deepEqual(parseInk('{"v":2,"strokes":[]}'), []);
  const good: InkStroke = { id: 'a', color: '#112233', width: 3, pts: [0, 0, 1, 1] };
  const raw = JSON.stringify({
    v: 1,
    strokes: [
      good,
      { id: 'b', color: 'red', width: 3, pts: [0, 0, 1, 1] }, // 색 형식 오류
      { id: 'c', color: '#112233', width: 999, pts: [0, 0, 1, 1] }, // 굵기 범위 밖
      { id: 'd', color: '#112233', width: 3, pts: [0, 0, 1] }, // 점이 홀수
      { id: 'e', color: '#112233', width: 3, pts: [0, 0, 'x', 1] }, // 숫자가 아님
      { id: 'f', color: '#112233', width: 3, pts: [0, 0, 1, 1], anchor: 5 }, // 붙은 상품 id가 글자가 아님
      null,
    ],
  });
  assert.deepEqual(parseInk(raw), [good]);
});

test('the number of saved strokes and points is capped', () => {
  const many: InkStroke[] = Array.from({ length: MAX_STROKES + 20 }, (_, i) => ({ id: `s${i}`, color: '#112233', width: 3, pts: [0, 0, 1, 1] }));
  const loaded = parseInk(serializeInk(many));
  assert.equal(loaded.length, MAX_STROKES);
  assert.equal(loaded[loaded.length - 1].id, `s${MAX_STROKES + 19}`);
  const long: Pt[] = Array.from({ length: 5000 }, (_, i) => ({ x: i * 4, y: (i % 7) * 4 }));
  const thinned = thinForStorage(long);
  assert.ok(thinned.length <= MAX_POINTS);
  assert.deepEqual([thinned[0], thinned[thinned.length - 1]], [long[0], long[long.length - 1]]);
});

test('old dates are pruned and only the kept dates remain', () => {
  const store = new Map<string, string>([
    [inkKey('2026-11-10', '1'), 'x'],
    [inkKey('2026-11-13', '2'), 'x'],
    [inkKey('2026-11-14', '1'), 'x'],
    ['board-view-only', '1'],
  ]);
  const storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
  };
  pruneInk(storage, ['2026-11-13', '2026-11-14']);
  assert.deepEqual([...store.keys()].sort(), [inkKey('2026-11-13', '2'), inkKey('2026-11-14', '1'), 'board-view-only'].sort());
});
