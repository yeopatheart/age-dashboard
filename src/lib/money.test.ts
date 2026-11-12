import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWon, formatWonInput, MAX_WON_DIGITS, parseWon, wonInputError } from './money.ts';

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

test('wonInputError accepts plain won amounts with commas, spaces and the 원 suffix', () => {
  for (const input of ['', '0', '1500', '1,234,567', ' 12 000 ', '5,000원', '9'.repeat(MAX_WON_DIGITS)]) assert.equal(wonInputError(input), null, input);
});

test('wonInputError rejects decimals, negatives, other characters and over-long numbers', () => {
  assert.match(wonInputError('1.5') ?? '', /소수점/);
  assert.match(wonInputError('-500') ?? '', /음수/);
  assert.match(wonInputError('−500') ?? '', /음수/);
  assert.match(wonInputError('12abc') ?? '', /숫자만/);
  assert.match(wonInputError('9'.repeat(MAX_WON_DIGITS + 1)) ?? '', /자리까지/);
});
