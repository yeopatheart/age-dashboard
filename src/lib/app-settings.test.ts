import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings } from './app-settings.ts';

test('boardInkSnapshotMinutes: 저장된 값이 없으면 기본 30분', () => {
  assert.equal(DEFAULT_SETTINGS.boardInkSnapshotMinutes, 30);
  assert.equal(mergeSettings(null).boardInkSnapshotMinutes, 30);
  assert.equal(mergeSettings({}).boardInkSnapshotMinutes, 30);
});

test('boardInkSnapshotMinutes: 5~240 범위의 값은 그대로 쓴다', () => {
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 5 }).boardInkSnapshotMinutes, 5);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 10 }).boardInkSnapshotMinutes, 10);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 240 }).boardInkSnapshotMinutes, 240);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: '45' }).boardInkSnapshotMinutes, 45);
});

test('boardInkSnapshotMinutes: 범위를 벗어나거나 숫자가 아니면 기본값으로 되돌린다', () => {
  for (const bad of [0, 4, 241, 9999, -10, 'abc', '', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.equal(mergeSettings({ boardInkSnapshotMinutes: bad }).boardInkSnapshotMinutes, 30, String(bad));
  }
});

test('boardInkSnapshotMinutes: 소수는 분 단위 정수로 반올림한다', () => {
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 7.4 }).boardInkSnapshotMinutes, 7);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 7.6 }).boardInkSnapshotMinutes, 8);
});

test('boardInkSnapshotMinutes를 추가해도 다른 설정 기본값은 그대로다', () => {
  const merged = mergeSettings({});
  assert.equal(merged.sizeTolerancePct, 10);
  assert.equal(merged.companyName, '통영아재수산');
  assert.deepEqual(merged.unshippedReasons, ['재고없음', '폐사', '품질불량']);
  assert.deepEqual(merged, DEFAULT_SETTINGS);
});
