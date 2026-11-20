import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EVENTS_PER_REQUEST, MAX_VALUE_MS, normalizePagePath, parsePerfPayload, toPerfRow } from './perf-payload.ts';

const ok = (over: Record<string, unknown> = {}) => ({ metric: 'nav', valueMs: 123.4, page: '/dashboard', monitor: '1', pointer: 'coarse', platform: 'Linux', viewport: '1920x1080', build: 'abc1234', ...over });

test('parsePerfPayload: 유효한 기록은 값을 정수로 반올림하고 허용된 필드만 남긴다', () => {
  const events = parsePerfPayload({ events: [{ ...ok(), extraMs: 40.6, api: 'loaf', secret: '고객명' }] });
  assert.equal(events?.length, 1);
  assert.deepEqual(events?.[0], { metric: 'nav', valueMs: 123, extraMs: 41, page: '/dashboard', monitor: '1', pointer: 'coarse', platform: 'Linux', viewport: '1920x1080', build: 'abc1234', api: 'loaf' });
  assert.ok(!('secret' in (events?.[0] ?? {})));
});

test('parsePerfPayload: 형식이 틀리거나 비었거나 너무 많으면 null', () => {
  assert.equal(parsePerfPayload(null), null);
  assert.equal(parsePerfPayload([]), null);
  assert.equal(parsePerfPayload({ events: 'x' }), null);
  assert.equal(parsePerfPayload({ events: [] }), null);
  assert.equal(parsePerfPayload({ events: Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => ok()) }), null);
  assert.equal(parsePerfPayload({ events: Array.from({ length: MAX_EVENTS_PER_REQUEST }, () => ok()) })?.length, MAX_EVENTS_PER_REQUEST);
});

test('parsePerfPayload: 잘못된 기록은 건너뛰고 나머지는 받는다', () => {
  const events = parsePerfPayload({
    events: [
      ok({ metric: 'drop_table' }),
      ok({ valueMs: -1 }),
      ok({ valueMs: MAX_VALUE_MS + 1 }),
      ok({ valueMs: Number.NaN }),
      ok({ valueMs: '12' }),
      ok({ page: '/a b' }),
      ok({ page: 'x'.repeat(65) }),
      'junk',
      ok({ valueMs: 5 }),
    ],
  });
  assert.equal(events?.length, 1);
  assert.equal(events?.[0].valueMs, 5);
});

test('parsePerfPayload: 허용 목록에 없는 기기 정보는 null로 비운다(기록 자체는 받는다)', () => {
  const [e] = parsePerfPayload({ events: [ok({ monitor: '3', pointer: 'mouse', platform: 'Linux x86_64', viewport: 'wide', build: 'ABC1234', api: 'x', extraMs: -5 })] }) ?? [];
  assert.equal(e.monitor, null);
  assert.equal(e.pointer, null);
  assert.equal(e.platform, null);
  assert.equal(e.viewport, null);
  assert.equal(e.build, null);
  assert.equal(e.api, null);
  assert.equal(e.extraMs, null);
});

test('parsePerfPayload: build는 7자리 소문자 16진수 또는 local만 받는다', () => {
  const builds = ['abc1234', 'local', 'abc123', 'abc12345', 'ABC1234'].map((build) => parsePerfPayload({ events: [ok({ build })] })?.[0].build);
  assert.deepEqual(builds, ['abc1234', 'local', null, null, null]);
});

test('normalizePagePath: 숫자·uuid 구간은 :id로 묶고 64자로 자른다', () => {
  assert.equal(normalizePagePath('/dashboard'), '/dashboard');
  assert.equal(normalizePagePath('/packing-log/123'), '/packing-log/:id');
  assert.equal(normalizePagePath('/x/9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f/edit'), '/x/:id/edit');
  assert.equal(normalizePagePath('/' + 'a'.repeat(100)).length, 64);
  assert.equal(normalizePagePath(''), '/');
});

test('toPerfRow: 열 이름이 DB 규칙(snake_case)이다', () => {
  const [e] = parsePerfPayload({ events: [ok({ extraMs: 10 })] }) ?? [];
  const row = toPerfRow(e);
  assert.equal(row.value_ms, 123);
  assert.equal(row.extra_ms, 10);
  assert.deepEqual(Object.keys(row).sort(), ['api', 'build', 'extra_ms', 'metric', 'monitor', 'page', 'platform', 'pointer', 'value_ms', 'viewport']);
});
