import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceProductName, similarProductNames, suspiciousNameReason } from './product-name-check.ts';

const known = ['참쥐치', '시마아지', '동호전갱이', '광어', '전어', '백합', '홍합', '자연산 방어', '자연산 대방어', '꽃게', '멍게'];

test('띄어쓰기만 다른 이름을 찾는다', () => {
  assert.deepEqual(similarProductNames('동호 전갱이', known), ['동호전갱이']);
});

test('3글자 이상은 한 글자 차이를 비슷하다고 본다', () => {
  assert.deepEqual(similarProductNames('참쥐지', known), ['참쥐치']);
  assert.deepEqual(similarProductNames('시미아지', known), ['시마아지']);
});

test('짧은 이름은 한 글자 차이를 비슷하다고 보지 않는다(다른 상품이다)', () => {
  assert.deepEqual(similarProductNames('광어', known), []);
  assert.deepEqual(similarProductNames('멍게', known), []);
  assert.deepEqual(similarProductNames('백합', known), []);
});

test('이름이 정확히 같은 상품은 비슷한 상품으로 내지 않는다', () => {
  assert.deepEqual(similarProductNames('참쥐치', known), []);
});

test('띄어쓰기 차이를 한 글자 차이보다 먼저 내고 최대 limit개만 낸다', () => {
  const list = ['자연산방어', '자연산 대방어', '자연산 방오'];
  assert.deepEqual(similarProductNames('자연산 방어', list), ['자연산방어', '자연산 대방어']);
  assert.equal(similarProductNames('자연산 방어', list, 1).length, 1);
});

test('수량·무게가 섞인 이름은 의심한다', () => {
  for (const name of ['금태 1상자', '자연산 전복 10미3270', '보리새우 20', '참쥐치 1키로', '양식말쥐치 500g', '자연산참돔 1.8키로재고']) {
    assert.ok(suspiciousNameReason(name), name);
  }
});

test('마침표·쉼표로 이어진 이름은 두 상품일 수 있다고 경고한다', () => {
  assert.match(suspiciousNameReason('대삼치. 학꽁치') ?? '', /마침표/);
  assert.match(suspiciousNameReason('참쥐치 1키로. 보리새우') ?? '', /마침표/);
});

test('메모처럼 보이는 표기는 의심한다', () => {
  assert.ok(suspiciousNameReason('보리새우 100미 - 가능한만큼'));
  assert.ok(suspiciousNameReason('자연산 전복(300이상)'));
});

test('정상적인 상품 이름은 의심하지 않는다', () => {
  for (const name of ['참쥐치', '자연산 대방어', '일산중대방어', '활무늬오징어', '학꽁치 대', '하프쉘']) {
    assert.equal(suspiciousNameReason(name), null, name);
  }
});

test('소수점이 들어간 무게는 마침표 경고로 보지 않고 수량 혼입으로 본다', () => {
  assert.match(suspiciousNameReason('자연산참돔 1.8키로재고') ?? '', /수량이나 무게/);
});

test('원문 상품 글자에서 이름 부분만 바꾼다', () => {
  assert.equal(replaceProductName('참쥐지 3미', '참쥐지', '참쥐치'), '참쥐치 3미');
  assert.equal(replaceProductName('하모 3미', '참쥐지', '참쥐치'), null);
});
