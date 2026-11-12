import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualItemChanged, resolveManualChangeStatus, type ManualItemContent } from './manual-item-status.ts';

const base: ManualItemContent = { productName: '활감성돔', quantity: 2, unit: '미', secondaryWeightKg: null, sizeRequest: null, isMulbong: false, hasAerator: false };

test('내용이 같으면 바뀌지 않은 것이다', () => {
  assert.equal(manualItemChanged(base, { ...base }), false);
});

test('수량·단위·상품명·무게·사이즈·포장 방식 중 하나만 달라도 바뀐 것이다', () => {
  const edits: Partial<ManualItemContent>[] = [
    { quantity: 3 },
    { unit: '박스' },
    { productName: '참돔' },
    { secondaryWeightKg: 3 },
    { sizeRequest: '대' },
    { isMulbong: true },
    { hasAerator: true },
  ];
  for (const edit of edits) assert.equal(manualItemChanged(base, { ...base, ...edit }), true, JSON.stringify(edit));
});

test('일반 상품의 내용을 고치면 수정됨으로 올린다', () => {
  assert.equal(resolveManualChangeStatus('none', 'none', true), 'modified');
});

test('내용이 그대로면 상태도 그대로다', () => {
  assert.equal(resolveManualChangeStatus('none', 'none', false), 'none');
});

test('신규·취소·이미 수정됨은 건드리지 않는다', () => {
  assert.equal(resolveManualChangeStatus('new', 'new', true), 'new');
  assert.equal(resolveManualChangeStatus('cancelled', 'cancelled', true), 'cancelled');
  assert.equal(resolveManualChangeStatus('modified', 'modified', true), 'modified');
});

test('사용자가 상태를 직접 바꿔 보낸 요청은 그대로 따른다', () => {
  assert.equal(resolveManualChangeStatus('none', 'new', true), 'new');
  assert.equal(resolveManualChangeStatus('modified', 'none', true), 'none');
});
