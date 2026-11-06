import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationsFor, missingTable } from './supabase/missing-table.ts';

test('a missing table is recognised and named', () => {
  assert.equal(missingTable(new Error("Could not find the table 'public.settlement_receipts' in the schema cache")), 'settlement_receipts');
});

test('columns added by migration 0047 point to that migration', () => {
  assert.equal(missingTable(new Error('column settlement_sales.unit_price does not exist')), 'settlement_receipts');
  assert.equal(missingTable(new Error("Could not find the 'seal_image' column of 'seller_businesses' in the schema cache")), 'settlement_receipts');
  assert.deepEqual(migrationsFor(['settlement_receipts']), ['0047_settlement_receipts.sql']);
});

test('other errors are not swallowed', () => {
  assert.equal(missingTable(new Error('permission denied for table settlement_sales')), null);
  assert.equal(missingTable('network down'), null);
  assert.equal(missingTable(null), null);
});
