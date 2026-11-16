import test from 'node:test';
import assert from 'node:assert/strict';
import { inkBlockers, parseBoardEnv } from './board-env.ts';

const ok = { penAvailable: true, isSplitMode: true, stageNative: true, canEdit: true, dateAllowsEdit: true };

test('모든 조건이 맞으면 막는 이유가 없다', () => {
  assert.deepEqual(inkBlockers(ok), []);
});

test('막는 조건마다 이유를 하나씩 알려 준다', () => {
  assert.equal(inkBlockers({ ...ok, stageNative: false }).length, 1);
  assert.match(inkBlockers({ ...ok, stageNative: false })[0], /기준 화면/);
  assert.match(inkBlockers({ ...ok, canEdit: false })[0], /권한/);
  assert.match(inkBlockers({ ...ok, dateAllowsEdit: false })[0], /지난 날짜/);
  assert.match(inkBlockers({ ...ok, penAvailable: false })[0], /터치/);
  assert.equal(inkBlockers({ penAvailable: false, isSplitMode: false, stageNative: false, canEdit: false, dateAllowsEdit: false }).length, 5);
});

const raw = {
  innerWidth: 1280, innerHeight: 720, outerWidth: 1280, outerHeight: 720, screenWidth: 3840, screenHeight: 2160, devicePixelRatio: 3,
  visualViewportWidth: 1280, visualViewportHeight: 720, visualViewportScale: 1, maxTouchPoints: 2, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/143', platform: 'Linux x86_64',
  monitor: '2', orderDate: '2026-11-16', today: '2026-11-16', sidebarCollapsed: true, penParam: null, stageOuterWidth: 1248, stageOuterHeight: 696, stageScale: 1,
  terms: ok, inkWriter: true, blockers: [], inkHidden: false, seq: 1, sinceLoadMs: 3000,
};

test('정상 값은 그대로 읽힌다', () => {
  const r = parseBoardEnv(raw);
  assert.ok(r);
  assert.equal(r?.innerHeight, 720);
  assert.equal(r?.inkWriter, true);
  assert.deepEqual(r?.blockers, []);
});

test('이유 목록은 보낸 값이 아니라 판정 조건에서 다시 만든다', () => {
  const r = parseBoardEnv({ ...raw, inkWriter: false, terms: { ...ok, stageNative: false }, blockers: ['임의의 글자'] });
  assert.equal(r?.blockers.length, 1);
  assert.match(r?.blockers[0] ?? '', /기준 화면/);
});

test('모양이 틀리면 버린다', () => {
  assert.equal(parseBoardEnv(null), null);
  assert.equal(parseBoardEnv('x'), null);
  assert.equal(parseBoardEnv({ ...raw, terms: null }), null);
  assert.equal(parseBoardEnv({ ...raw, inkWriter: 'yes' }), null);
});

test('긴 글자·줄바꿈·이상한 숫자는 걸러서 로그가 흐트러지지 않게 한다', () => {
  const r = parseBoardEnv({ ...raw, userAgent: 'a\nb'.repeat(500), innerWidth: Number.NaN, devicePixelRatio: Infinity, seq: 9999 });
  assert.ok(r);
  assert.ok((r?.userAgent.length ?? 0) <= 300);
  assert.ok(!/[\r\n]/.test(r?.userAgent ?? ''));
  assert.equal(r?.innerWidth, 0);
  assert.equal(r?.devicePixelRatio, 1);
  assert.equal(r?.seq, 20);
});
