import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings } from './app-settings.ts';

test('boardInkSnapshotMinutes: 저장된 값이 없으면 기본 10분', () => {
  assert.equal(DEFAULT_SETTINGS.boardInkSnapshotMinutes, 10);
  assert.equal(mergeSettings(null).boardInkSnapshotMinutes, 10);
  assert.equal(mergeSettings({}).boardInkSnapshotMinutes, 10);
});

test('boardInkSnapshotMinutes: 5~240 범위의 값은 그대로 쓴다', () => {
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 5 }).boardInkSnapshotMinutes, 5);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 10 }).boardInkSnapshotMinutes, 10);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: 240 }).boardInkSnapshotMinutes, 240);
  assert.equal(mergeSettings({ boardInkSnapshotMinutes: '45' }).boardInkSnapshotMinutes, 45);
});

test('boardInkSnapshotMinutes: 범위를 벗어나거나 숫자가 아니면 기본값으로 되돌린다', () => {
  for (const bad of [0, 4, 241, 9999, -10, 'abc', '', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.equal(mergeSettings({ boardInkSnapshotMinutes: bad }).boardInkSnapshotMinutes, 10, String(bad));
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

test('boardInkSnapshotStartHour·EndHour: 기본은 4시~16시', () => {
  assert.equal(DEFAULT_SETTINGS.boardInkSnapshotStartHour, 4);
  assert.equal(DEFAULT_SETTINGS.boardInkSnapshotEndHour, 16);
  assert.equal(mergeSettings({}).boardInkSnapshotStartHour, 4);
  assert.equal(mergeSettings(null).boardInkSnapshotEndHour, 16);
});

test('boardInkSnapshotStartHour·EndHour: 0~23 값은 그대로 쓰고 같은 값·자정을 넘기는 값도 허용한다', () => {
  for (const h of [0, 4, 12, 16, 23]) {
    assert.equal(mergeSettings({ boardInkSnapshotStartHour: h }).boardInkSnapshotStartHour, h);
    assert.equal(mergeSettings({ boardInkSnapshotEndHour: h }).boardInkSnapshotEndHour, h);
  }
  const wrap = mergeSettings({ boardInkSnapshotStartHour: 22, boardInkSnapshotEndHour: 6 });
  assert.equal(wrap.boardInkSnapshotStartHour, 22);
  assert.equal(wrap.boardInkSnapshotEndHour, 6);
  const same = mergeSettings({ boardInkSnapshotStartHour: 9, boardInkSnapshotEndHour: 9 });
  assert.equal(same.boardInkSnapshotStartHour, 9);
  assert.equal(same.boardInkSnapshotEndHour, 9);
  assert.equal(mergeSettings({ boardInkSnapshotStartHour: '7' }).boardInkSnapshotStartHour, 7);
});

test('boardInkSnapshotStartHour·EndHour: 범위를 벗어나거나 숫자가 아니면 기본값, 소수는 반올림', () => {
  for (const bad of [-1, 24, 99, 'abc', '', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.equal(mergeSettings({ boardInkSnapshotStartHour: bad }).boardInkSnapshotStartHour, 4, String(bad));
    assert.equal(mergeSettings({ boardInkSnapshotEndHour: bad }).boardInkSnapshotEndHour, 16, String(bad));
  }
  assert.equal(mergeSettings({ boardInkSnapshotStartHour: 5.4 }).boardInkSnapshotStartHour, 5);
  assert.equal(mergeSettings({ boardInkSnapshotEndHour: 15.6 }).boardInkSnapshotEndHour, 16);
});

test('boardInkHistoryKeepDays: 기본은 2영업일, 1~30 정수는 그대로 쓴다', () => {
  assert.equal(DEFAULT_SETTINGS.boardInkHistoryKeepDays, 2);
  assert.equal(mergeSettings(null).boardInkHistoryKeepDays, 2);
  assert.equal(mergeSettings({}).boardInkHistoryKeepDays, 2);
  for (const d of [1, 2, 3, 30]) assert.equal(mergeSettings({ boardInkHistoryKeepDays: d }).boardInkHistoryKeepDays, d);
  assert.equal(mergeSettings({ boardInkHistoryKeepDays: '5' }).boardInkHistoryKeepDays, 5);
});

test('boardInkHistoryKeepDays: 범위를 벗어나거나 숫자가 아니면 기본값, 소수는 반올림', () => {
  for (const bad of [0, -1, 31, 100, 'abc', '', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.equal(mergeSettings({ boardInkHistoryKeepDays: bad }).boardInkHistoryKeepDays, 2, String(bad));
  }
  assert.equal(mergeSettings({ boardInkHistoryKeepDays: 2.4 }).boardInkHistoryKeepDays, 2);
  assert.equal(mergeSettings({ boardInkHistoryKeepDays: 2.6 }).boardInkHistoryKeepDays, 3);
});
