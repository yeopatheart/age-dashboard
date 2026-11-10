import test from 'node:test';
import assert from 'node:assert/strict';
import { labelNeedsReprint, printedBoxTypeValue, templateShowsBoxType } from './labels/reprint.ts';
import { LABEL_PRESETS, SAMPLE_LABEL_DATA, elementText, fieldText, parseElements, type LabelTemplate } from './labels/template.ts';
import { migrationsFor, missingTable } from './supabase/missing-table.ts';

const withBoxType: LabelTemplate = { widthMm: 100, heightMm: 80, elements: [{ id: 'b', type: 'field', field: 'boxType', x: 0, y: 0, w: 40, h: 8, fontSize: 20, bold: true, align: 'left' }] };
const without: LabelTemplate = { widthMm: 100, heightMm: 80, elements: [{ id: 't', type: 'field', field: 'terminal', x: 0, y: 0, w: 40, h: 8, fontSize: 20, bold: true, align: 'left' }] };

test('boxType field prints the box type text and survives a save/load round trip', () => {
  assert.equal(fieldText('boxType', { ...SAMPLE_LABEL_DATA, boxType: '대박스' }), '대박스');
  assert.equal(elementText(withBoxType.elements[0], { ...SAMPLE_LABEL_DATA, boxType: '물봉' }), '물봉');
  assert.equal(parseElements(withBoxType.elements)[0].field, 'boxType');
  assert.equal(fieldText('boxType', { ...SAMPLE_LABEL_DATA, boxType: '' }), '');
});

test('built-in presets do not print the box type by default', () => {
  assert.ok(LABEL_PRESETS.length >= 2);
  for (const preset of LABEL_PRESETS) assert.equal(templateShowsBoxType(preset.template), false, preset.key);
  assert.equal(templateShowsBoxType(withBoxType), true);
});

test('printed value is recorded only when the design shows the box type', () => {
  assert.equal(printedBoxTypeValue(withBoxType, '물봉'), '물봉');
  assert.equal(printedBoxTypeValue(withBoxType, ''), '');
  assert.equal(printedBoxTypeValue(without, '물봉'), null);
});

test('reprint is needed when the printed box type differs from the submitted one', () => {
  const base = { templateShowsBoxType: true, printCount: 1, printedBoxType: '중', currentBoxType: '중' };
  assert.equal(labelNeedsReprint(base), false);
  assert.equal(labelNeedsReprint({ ...base, currentBoxType: '대' }), true);
});

test('labels printed without a box type need reprint once the design shows it', () => {
  const base = { templateShowsBoxType: true, printCount: 2, printedBoxType: null, currentBoxType: '대' };
  assert.equal(labelNeedsReprint(base), true);
  assert.equal(labelNeedsReprint({ ...base, currentBoxType: '' }), false); // 찍을 박스 종류가 없으면 다시 붙일 이유가 없다
});

test('no reprint warning when the design has no box type, nothing was printed, or the printed value is unknown', () => {
  const base = { templateShowsBoxType: true, printCount: 1, printedBoxType: '중', currentBoxType: '대' };
  assert.equal(labelNeedsReprint({ ...base, templateShowsBoxType: false }), false);
  assert.equal(labelNeedsReprint({ ...base, printCount: 0 }), false);
  assert.equal(labelNeedsReprint({ ...base, printedBoxType: undefined }), false);
});

test('missing printed_box_type column is recognised and points to migration 0051', () => {
  const message = 'column box_labels.printed_box_type does not exist';
  assert.equal(missingTable(message), 'label_printed_box_type');
  assert.deepEqual(migrationsFor(['label_printed_box_type']), ['0051_label_printed_box_type.sql']);
});
