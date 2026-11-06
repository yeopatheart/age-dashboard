import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, trainModel, type TrainingRecord } from './packing/model.ts';

const item = (name: string, quantity: number) => ({ name, unit: '미', quantity, mulbongFlag: false });

const records: TrainingRecord[] = ['2026-11-01', '2026-11-02', '2026-11-03'].map((orderDate) => ({
  orderDate,
  businessName: '엔야',
  boxes: [{ boxName: '소', isMulbongBox: false, items: [item('광어', 2)] }],
}));

test('an untrained model still answers without throwing', () => {
  const model = trainModel([], { version: 'test', trainedAt: '2026-11-06T00:00:00Z' });
  const result = recommend(model, [item('광어', 2)]);
  assert.equal(result.modelVersion, 'test');
  assert.notEqual(result.confidence, 'high');
});

test('no items means no candidates', () => {
  const model = trainModel(records, { version: 'test', trainedAt: '2026-11-06T00:00:00Z' });
  const result = recommend(model, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.confidence, 'low');
});

test('a repeated order is recommended into the box it was packed in before', () => {
  const model = trainModel(records, { version: 'test', trainedAt: '2026-11-06T00:00:00Z' });
  const result = recommend(model, [item('광어', 2)]);
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0].boxes[0].boxName, '소');
});

test('training is deterministic', () => {
  const meta = { version: 'test', trainedAt: '2026-11-06T00:00:00Z' };
  assert.deepEqual(trainModel(records, meta), trainModel(records, meta));
});
