import test from 'node:test';
import assert from 'node:assert/strict';
import { fixInputTypos, normalizeUnit, parseKakaoMessage } from './kakao-parser.ts';

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

test('전각 숫자·기호는 일반 문자로 읽는다 (３키로 = 3kg)', () => {
  const [line] = parseKakaoMessage('남부／ 스시집／ 활전갱이 ３키로，벤자리 ２미');
  assert.equal(line.terminalName, '남부');
  assert.equal(line.businessName, '스시집');
  assert.equal(line.products.length, 2);
  assert.deepEqual([line.products[0].productName, line.products[0].quantity, line.products[0].unit], ['활전갱이', 3, 'kg']);
  assert.deepEqual([line.products[1].productName, line.products[1].quantity, line.products[1].unit], ['벤자리', 2, '미']);
  assert.equal(line.raw, '남부／ 스시집／ 활전갱이 ３키로，벤자리 ２미'); // 줄 원문은 입력 그대로
  assert.ok(line.products.every((p) => p.normalizedFrom !== undefined)); // 확인 화면에 '정리됨' 표시
});

test('소수점 쉼표는 소수점으로 읽는다 (1,5키로 = 1.5kg)', () => {
  const [line] = parseKakaoMessage('남부/ 스시집/ 장어 1,5키로, 광어 2미');
  assert.equal(line.products.length, 2);
  assert.deepEqual([line.products[0].productName, line.products[0].quantity, line.products[0].unit], ['장어', 1.5, 'kg']);
  assert.equal(line.products[1].quantity, 2);
});

test('그램의 천 단위 쉼표는 쉼표만 뗀다 (1,000g = 1kg)', () => {
  const [line] = parseKakaoMessage('남부/ 스시집/ 도미 1,000g');
  assert.deepEqual([line.products[0].quantity, line.products[0].unit], [1, 'kg']);
});

test('수량 앞의 마이너스는 뗀다 (광어 -3미 = 3미)', () => {
  const [line] = parseKakaoMessage('남부/ 스시집/ 광어 -3미, 도미 −2kg');
  assert.deepEqual([line.products[0].productName, line.products[0].quantity, line.products[0].unit], ['광어', 3, '미']);
  assert.deepEqual([line.products[1].productName, line.products[1].quantity, line.products[1].unit], ['도미', 2, 'kg']);
});

test('사이즈의 숫자 사이 하이픈과 정상 줄은 건드리지 않는다', () => {
  assert.equal(fixInputTypos('남부/ 스시집/ 활전갱이 3미(4-600), 하모 키로6-8미'), '남부/ 스시집/ 활전갱이 3미(4-600), 하모 키로6-8미');
  assert.equal(fixInputTypos('남부/ 스시집/ 광어 2미, 도미 3,5미'.replace('3,5미', '3미')), '남부/ 스시집/ 광어 2미, 도미 3미');
  const [line] = parseKakaoMessage('남부/ 스시집/ 광어 2미, 도미 3미');
  assert.ok(line.products.every((p) => p.normalizedFrom === undefined));
});

test('상품 구분 쉼표는 소수점 쉼표로 오해하지 않는다', () => {
  const [line] = parseKakaoMessage('남부/ 스시집/ 광어 2미,도미 3미');
  assert.equal(line.products.length, 2);
});
