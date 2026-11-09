import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCAN_SHARE_TEMPLATE,
  SHARE_SLOT_MAX_CHARS,
  SHARE_VARIABLES,
  formatShareDate,
  normalizeScanShareTemplate,
  renderShareSlot,
  shareSlotError,
  shareTemplateError,
} from './scan-share-template.ts';

test('날짜 형식 세 가지', () => {
  assert.equal(formatShareDate('2026-11-06', 'md-weekday'), '11/06(금)');
  assert.equal(formatShareDate('2026-11-06', 'korean'), '11월 6일(금)');
  assert.equal(formatShareDate('2026-11-06', 'iso'), '2026-11-06');
  assert.equal(formatShareDate('2026-01-05', 'korean'), '1월 5일(월)');
  assert.equal(formatShareDate('이상한값', 'iso'), '이상한값');
});

test('변수 치환: 알려진 변수만 바꾸고 모르는 변수와 일반 글자는 그대로 둔다', () => {
  assert.equal(renderShareSlot('{날짜} {터미널명} 상차 {합계}박스', { 날짜: '11/06(금)', 터미널명: '대구', 합계: 5 }), '11/06(금) 대구 상차 5박스');
  assert.equal(renderShareSlot('{모름} {날짜}', { 날짜: 'x' }), '{모름} x');
  assert.equal(renderShareSlot('그냥 글', {}), '그냥 글');
  assert.equal(renderShareSlot('{박스수}', { 박스수: '2/4' }), '2/4');
});

test('저장 검증: 기본 템플릿은 통과한다', () => {
  assert.equal(shareTemplateError(DEFAULT_SCAN_SHARE_TEMPLATE), null);
});

test('저장 검증: 그 줄에서 못 쓰는 변수·모르는 변수·짝이 안 맞는 중괄호·긴 글을 거른다', () => {
  assert.match(shareSlotError('header', '{고객사명} 상차') ?? '', /첫 줄에서 쓸 수 없는 변수 \{고객사명\}/);
  assert.match(shareSlotError('line', '{모르는변수}') ?? '', /쓸 수 없는 변수 \{모르는변수\}/);
  assert.match(shareSlotError('total', '합계 {합계') ?? '', /중괄호/);
  assert.match(shareSlotError('total', '합계 }') ?? '', /중괄호/);
  assert.match(shareSlotError('pending', 'x'.repeat(SHARE_SLOT_MAX_CHARS + 1)) ?? '', /120자/);
  assert.equal(shareSlotError('pending', '{미상차목록}'), null);
  assert.equal(shareSlotError('header', ''), null); // 비운 줄은 허용(글에서 빠진다)
  assert.match(shareTemplateError({ ...DEFAULT_SCAN_SHARE_TEMPLATE, total: '{없음}' }) ?? '', /합계 줄/);
});

test('줄마다 허용 변수 목록이 비어 있지 않고 이름이 중복되지 않는다', () => {
  for (const vars of Object.values(SHARE_VARIABLES)) {
    assert.ok(vars.length > 0);
    assert.equal(new Set(vars.map((v) => v.name)).size, vars.length);
  }
});

test('저장된 값 정규화: 모양이 이상하면 기본값, 줄바꿈은 공백으로', () => {
  assert.deepEqual(normalizeScanShareTemplate(null), DEFAULT_SCAN_SHARE_TEMPLATE);
  assert.deepEqual(normalizeScanShareTemplate('x'), DEFAULT_SCAN_SHARE_TEMPLATE);
  const t = normalizeScanShareTemplate({ header: '첫\n줄', line: 3, showPending: 'yes', dateFormat: 'nope', total: '합계 {합계}' });
  assert.equal(t.header, '첫 줄');
  assert.equal(t.line, DEFAULT_SCAN_SHARE_TEMPLATE.line);
  assert.equal(t.showPending, true);
  assert.equal(t.dateFormat, 'md-weekday');
  assert.equal(t.total, '합계 {합계}');
  assert.equal(normalizeScanShareTemplate({ showPending: false, dateFormat: 'iso' }).dateFormat, 'iso');
  assert.equal(normalizeScanShareTemplate({ showPending: false }).showPending, false);
});
