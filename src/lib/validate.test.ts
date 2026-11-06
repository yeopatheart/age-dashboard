import test from 'node:test';
import assert from 'node:assert/strict';
import { isIsoDate, nonNegativeNumberError, positiveNumberError, textError } from './validate.ts';

test('isIsoDate accepts real dates only', () => {
  assert.equal(isIsoDate('2026-11-14'), true);
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('2026-1-1'), false);
  assert.equal(isIsoDate("2026-11-14'; drop table x;--"), false);
  assert.equal(isIsoDate(''), false);
});

test('textError rejects blank and over-long text', () => {
  assert.equal(textError('  ', '이름', 10) !== null, true);
  assert.equal(textError('a'.repeat(11), '이름', 10) !== null, true);
  assert.equal(textError(' 엔야 ', '이름', 10), null);
});

test('number validators reject NaN, Infinity, and out-of-range values', () => {
  assert.notEqual(positiveNumberError(0, '수량'), null);
  assert.notEqual(positiveNumberError(-1, '수량'), null);
  assert.notEqual(positiveNumberError(Number.NaN, '수량'), null);
  assert.notEqual(positiveNumberError(Number.POSITIVE_INFINITY, '수량'), null);
  assert.notEqual(positiveNumberError(1e9, '수량'), null);
  assert.equal(positiveNumberError(0.5, '수량'), null);
  assert.equal(nonNegativeNumberError(0, '무게'), null);
  assert.notEqual(nonNegativeNumberError(-0.1, '무게'), null);
});
