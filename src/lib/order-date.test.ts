import test from 'node:test';
import assert from 'node:assert/strict';
import { editableDateError, todayKST, tomorrowKST } from './order-date.ts';

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('todayKST returns an ISO date', () => {
  assert.match(todayKST(), /^\d{4}-\d{2}-\d{2}$/);
});

test('future dates are always rejected', () => {
  const tomorrow = shift(todayKST(), 1);
  assert.notEqual(editableDateError(tomorrow, true), null);
  assert.notEqual(editableDateError(tomorrow, false), null);
});

test('today is always editable', () => {
  assert.equal(editableDateError(todayKST(), false), null);
});

test('past dates need the allowPast setting', () => {
  const yesterday = shift(todayKST(), -1);
  assert.notEqual(editableDateError(yesterday, false), null);
  assert.equal(editableDateError(yesterday, true), null);
});

test('tomorrowKST is the day after todayKST', () => {
  assert.equal(tomorrowKST(), shift(todayKST(), 1));
});

test('tomorrow is editable only where allowTomorrow is set (order entry, box assignment), and never further ahead', () => {
  const tomorrow = shift(todayKST(), 1);
  assert.equal(editableDateError(tomorrow, false, { allowTomorrow: true }), null);
  assert.notEqual(editableDateError(shift(todayKST(), 2), true, { allowTomorrow: true }), null);
  assert.notEqual(editableDateError(tomorrow, true), null); // 기본값은 그대로 막는다
});
