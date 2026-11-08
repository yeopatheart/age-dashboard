import test from 'node:test';
import assert from 'node:assert/strict';
import { labelPrintStatus } from './label-status.ts';

test('counts distinct printed box numbers within 1..total', () => {
  assert.deepEqual(labelPrintStatus(3, [1, 3]), { printed: 2, total: 3 });
  assert.deepEqual(labelPrintStatus(3, [1, 1, 2, 3]), { printed: 3, total: 3 });
  assert.deepEqual(labelPrintStatus(3, []), { printed: 0, total: 3 });
});

test('ignores leftover numbers above the box count', () => {
  assert.deepEqual(labelPrintStatus(2, [1, 2, 3, 4]), { printed: 2, total: 2 });
});

test('caps at 99 and tolerates zero boxes', () => {
  assert.deepEqual(labelPrintStatus(0, [1]), { printed: 0, total: 0 });
  assert.equal(labelPrintStatus(150, [99, 100]).total, 99);
});
