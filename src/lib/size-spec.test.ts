import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSizeSpec } from './size-spec.ts';
import { DEFAULT_SETTINGS } from './app-settings.ts';

const spec = (raw: string) => parseSizeSpec(raw, DEFAULT_SETTINGS);

test('g 단위 이상/이하: 600g이상, 400g이상, 200g이하', () => {
  assert.equal(spec('600g이상').minG, 600);
  assert.equal(spec('400g이상').minG, 400);
  assert.equal(spec('200g이하').maxG, 200);
  assert.deepEqual(spec('600g이상').unparsed, []);
});

test('기존 표기는 그대로: 300이상(g), 2kg이상, 4kg이상, 4-600', () => {
  assert.equal(spec('300이상').minG, 300);
  assert.equal(spec('2kg이상').minG, 2000);
  assert.equal(spec('4kg이상').minG, 4000);
  assert.equal(spec('4-600').minG, 400);
  assert.equal(spec('4-600').maxG, 600);
});

test('단위만 쓴 크기(200g, 150g, 1kg)는 내외로 읽는다', () => {
  const tol = DEFAULT_SETTINGS.sizeTolerancePct / 100;
  assert.equal(spec('200g').minG, Math.round(200 * (1 - tol)));
  assert.equal(spec('200g').maxG, Math.round(200 * (1 + tol)));
  assert.equal(spec('1kg').minG, Math.round(1000 * (1 - tol)));
  assert.equal(spec('150g').unparsed.length, 0);
  assert.equal(spec('500g내외').minG, Math.round(500 * (1 - tol)));
});

test('"대 : 선별"은 사이즈 대 + 등급 선별로 읽는다, 기포기 같은 작업 지시는 따로 둔다', () => {
  const s = spec('대 : 선별, 기포기');
  assert.equal(s.relative, 'large');
  assert.equal(s.grade, '선별');
  assert.deepEqual(s.handling, ['기포기']);
  assert.deepEqual(s.unparsed, []);
  assert.equal(spec('소').relative, 'small');
});

test('여전히 모르는 표기는 해석 못 함으로 남긴다', () => {
  assert.deepEqual(spec('아주특별한').unparsed, ['아주특별한']);
});
