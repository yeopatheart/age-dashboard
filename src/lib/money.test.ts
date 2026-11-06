import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWon, formatWonInput, MAX_WON_DIGITS, parseWon } from './money.ts';

test('parseWon keeps digits only', () => {
  assert.equal(parseWon('1,234,567원'), 1234567);
  assert.equal(parseWon('abc'), null);
  assert.equal(parseWon(''), null);
});

test('parseWon caps the digit count so the value stays a safe integer', () => {
  const value = parseWon('9'.repeat(30));
  assert.equal(String(value).length, MAX_WON_DIGITS);
  assert.ok(Number.isSafeInteger(value));
});

test('formatWon / formatWonInput add thousands separators', () => {
  assert.equal(formatWon(1234567), '1,234,567');
  assert.equal(formatWon(null), '');
  assert.equal(formatWonInput('12abc345'), '12,345');
});
