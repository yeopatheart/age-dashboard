import test from 'node:test';
import assert from 'node:assert/strict';
import { barcodeProblem, isValidBoxBarcode, makeBoxBarcode, normalizeBarcodeInput } from './labels/barcode.ts';

const good = makeBoxBarcode('2026-11-12', 7, 2);

test('공백과 여러 종류의 하이픈을 지운다', () => {
  assert.equal(normalizeBarcodeInput(' 2611 12-007-02 '), '26111200702');
  assert.equal(normalizeBarcodeInput('26–11−12 007'), '26111200' + '7');
  assert.equal(normalizeBarcodeInput(good), good);
});

test('하이픈으로 나눠 붙여넣은 올바른 번호도 통과한다', () => {
  const dashed = `${good.slice(0, 6)}-${good.slice(6, 9)}-${good.slice(9, 11)}-${good.slice(11)}`;
  assert.equal(barcodeProblem(normalizeBarcodeInput(dashed)), null);
});

test('숫자 12자리가 아니면 형식 오류다', () => {
  assert.equal(barcodeProblem(''), 'format');
  assert.equal(barcodeProblem('12345'), 'format');
  assert.equal(barcodeProblem(`${good}0`), 'format');
  assert.equal(barcodeProblem('abcdefghijkl'), 'format');
  assert.equal(barcodeProblem('https://example.com'), 'format');
});

test('12자리인데 확인 숫자가 틀리면 확인 숫자 오류다', () => {
  const wrong = `${good.slice(0, 11)}${(Number(good[11]) + 1) % 10}`;
  assert.equal(barcodeProblem(wrong), 'check');
  assert.equal(isValidBoxBarcode(wrong), false);
});

test('올바른 번호는 문제가 없다', () => {
  assert.equal(barcodeProblem(good), null);
  assert.equal(isValidBoxBarcode(good), true);
});
