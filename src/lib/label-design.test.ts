import test from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_PRESETS, buildTemplate, elementProblem, foldOf, normalizeTemplate, parseElements, type LabelTemplate } from './labels/template.ts';
import { migrationsFor, missingTable } from './supabase/missing-table.ts';

const preset = (key: string) => LABEL_PRESETS.find((p) => p.key === key)!.template;
const row = (t: LabelTemplate) => ({ width_mm: t.widthMm, height_mm: t.heightMm, elements: t.elements });

test('wrap preset has a fold element; flat preset has none', () => {
  assert.deepEqual(foldOf(preset('wrap')), { yMm: 60, sideWidthMm: 100 });
  assert.equal(foldOf(preset('flat')), null);
});

// 읽을 때 채워 넣는 기본값(정렬 left 등)은 빼고, 배치를 정하는 값만 비교한다.
const layout = (t: LabelTemplate) => ({ w: t.widthMm, h: t.heightMm, els: t.elements.map((e) => [e.id, e.type, e.field, e.text, e.x, e.y, e.w, e.h, e.fontSize, e.bold === true]) });

test('presets survive a save/load round trip unchanged', () => {
  for (const p of LABEL_PRESETS) assert.deepEqual(layout(buildTemplate(row(p.template))), layout(p.template), p.key);
});

test('no preset element sits on the fold keep-out zone or outside the label', () => {
  for (const p of LABEL_PRESETS) {
    for (const el of p.template.elements) {
      if (el.type === 'fold') continue;
      assert.equal(elementProblem(el, p.template), null, `${p.key}/${el.id}`);
      assert.ok(el.x >= 0 && el.y >= 0 && el.x + el.w <= p.template.widthMm && el.y + el.h <= p.template.heightMm, `${p.key}/${el.id} out of bounds`);
    }
  }
});

test('without a fold nothing is restricted', () => {
  const flat = preset('flat');
  assert.equal(elementProblem({ x: 0, y: 40, w: 100, h: 10 }, flat), null);
});

test('with a fold, elements on the fold line or outside the narrow side width are flagged', () => {
  const t = normalizeTemplate({ ...preset('wrap'), elements: preset('wrap').elements.map((e) => (e.type === 'fold' ? { ...e, w: 60 } : e)) });
  assert.equal(elementProblem({ x: 4, y: 59, w: 10, h: 2 }, t), 'fold');
  assert.equal(elementProblem({ x: 4, y: 65, w: 10, h: 5 }, t), 'side-width');
  assert.equal(elementProblem({ x: 25, y: 65, w: 10, h: 5 }, t), null);
});

test('only the first fold element is kept, and it has no height', () => {
  const els = parseElements([
    { id: 'a', type: 'fold', x: 0, y: 50, w: 100, h: 5 },
    { id: 'b', type: 'fold', x: 0, y: 30, w: 100, h: 0 },
  ]);
  assert.equal(els.length, 1);
  assert.equal(els[0].id, 'a');
  assert.equal(els[0].h, 0);
});

test('normalize keeps the fold centred, narrower than the label and inside the label height', () => {
  const t = normalizeTemplate({ widthMm: 50, heightMm: 40, elements: [{ id: 'f', type: 'fold', x: 0, y: 70, w: 100, h: 0 }] });
  assert.deepEqual(foldOf(t), { yMm: 32, sideWidthMm: 50 });
  assert.equal(t.elements[0].x, 0);
  const narrow = normalizeTemplate({ widthMm: 100, heightMm: 80, elements: [{ id: 'f', type: 'fold', x: 0, y: 2, w: 40, h: 0 }] });
  assert.deepEqual(foldOf(narrow), { yMm: 10, sideWidthMm: 40 });
  assert.equal(narrow.elements[0].x, 30);
});

test('a stored design without a fold element loads as a top-only label', () => {
  const t = buildTemplate({ width_mm: 100, height_mm: 80, elements: [{ id: 'q', type: 'barcode', x: 4, y: 4, w: 21, h: 21 }] });
  assert.equal(foldOf(t), null);
  assert.equal(t.elements.length, 1);
});

test('label_designs points to migration 0050', () => {
  assert.equal(missingTable(new Error("Could not find the table 'public.label_designs' in the schema cache")), 'label_designs');
  assert.deepEqual(migrationsFor(['label_designs']), ['0050_label_designs.sql']);
});
