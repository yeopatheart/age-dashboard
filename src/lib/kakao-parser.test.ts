import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnit, parseKakaoMessage } from './kakao-parser.ts';

test('normalizeUnit unifies 마리/미 and 키로/kg', () => {
  assert.equal(normalizeUnit('마리'), '미');
  assert.equal(normalizeUnit('미'), '미');
  assert.equal(normalizeUnit('키로'), 'kg');
  assert.equal(normalizeUnit('KG'), 'kg');
});

test('parses terminal / business / products and ignores date header lines', () => {
  const lines = parseKakaoMessage('9/29(화)\n1 대구/ 엔야/ 활전갱이 5미, 활고등어 2kg');
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.equal(line.terminalName, '대구');
  assert.equal(line.businessName, '엔야');
  assert.equal(line.needsReview, false);
  assert.deepEqual(
    line.products.map((p) => [p.productName, p.quantity, p.unit]),
    [['활전갱이', 5, '미'], ['활고등어', 2, 'kg']],
  );
});

test('count + weight with "+" keeps both quantities', () => {
  const [line] = parseKakaoMessage('대구/ 엔야/ 감성돔 1미+2.5kg');
  const [p] = line.products;
  assert.equal(p.quantity, 1);
  assert.equal(p.unit, '미');
  assert.equal(p.secondaryWeightKg, 2.5);
});

test('grams are converted to kg', () => {
  const [line] = parseKakaoMessage('남부/ 신라호텔/ 전복 500g');
  const [p] = line.products;
  assert.equal(p.quantity, 0.5);
  assert.equal(p.unit, 'kg');
});

test('lines without the 3-part split are flagged for review, not guessed', () => {
  const [line] = parseKakaoMessage('대구/ 엔야');
  assert.equal(line.needsReview, true);
  assert.equal(line.products.length, 0);
});

test('empty input produces no lines', () => {
  assert.deepEqual(parseKakaoMessage(''), []);
  assert.deepEqual(parseKakaoMessage('\n\n  \n'), []);
});
