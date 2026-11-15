import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyEffects, parseEffects, planUndo, summarizeEffects, type ChangedItemEffect, type CurrentItem, type InputEffects, type ItemBefore } from './order-input-undo.ts';

const before: ItemBefore = {
  quantity: 2, unit: '미', secondary_weight_kg: null, size_request: null, size_spec: null, is_mulbong: false, has_aerator: false,
  mulbong_box_count: null, has_ice_pack: false, from_stock: false, change_status: 'none', needs_review: false, review_reason: null, unshipped_quantity: 0,
};
const cur = (o: Partial<CurrentItem> & { id: string }): CurrentItem => ({ product_name_raw: '광어', quantity: 3, unit: '미', change_status: 'new', is_packed: false, unshipped_quantity: 0, ...o });
const map = (...items: CurrentItem[]) => new Map(items.map((i) => [i.id, i]));
const noMemos = new Map();

const effects = (): InputEffects => ({
  ...emptyEffects(),
  createdCardIds: ['card1'],
  createdItems: [{ id: 'n1', dailyBusinessId: 'card1', productName: '광어', quantity: 3, unit: '미' }],
});

test('새로 만든 줄은 그대로면 "취소" 상태로 바꾼다(지우지 않는다)', () => {
  const plan = planUndo(effects(), map(cur({ id: 'n1' })), noMemos);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.cancelItemIds, ['n1']);
});

test('포장 체크된 줄이 있으면 아무것도 바꾸지 않고 알린다', () => {
  const plan = planUndo(effects(), map(cur({ id: 'n1', is_packed: true })), noMemos);
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.conflicts[0], /포장 체크/);
});

test('입력 뒤에 수량·단위·이름이 고쳐진 줄은 충돌이다', () => {
  assert.equal(planUndo(effects(), map(cur({ id: 'n1', quantity: 5 })), noMemos).conflicts.length, 1);
  assert.equal(planUndo(effects(), map(cur({ id: 'n1', unit: 'kg' })), noMemos).conflicts.length, 1);
  assert.equal(planUndo(effects(), map(cur({ id: 'n1', product_name_raw: '우럭' })), noMemos).conflicts.length, 1);
});

test('미출고가 있는 줄은 충돌이다', () => {
  assert.equal(planUndo(effects(), map(cur({ id: 'n1', unshipped_quantity: 1 })), noMemos).conflicts.length, 1);
});

test('이미 취소됐거나 지워진 줄은 건너뛴다(재시도해도 같은 결과)', () => {
  const a = planUndo(effects(), map(cur({ id: 'n1', change_status: 'cancelled' })), noMemos);
  assert.deepEqual([a.conflicts, a.cancelItemIds], [[], []]);
  const b = planUndo(effects(), new Map(), noMemos);
  assert.deepEqual([b.conflicts, b.cancelItemIds], [[], []]);
});

const changed = (kind: ChangedItemEffect['kind']): InputEffects => ({
  ...emptyEffects(),
  changedItems: [{ id: 'c1', kind, productName: '도미', before: { ...before, quantity: 2, change_status: 'none' }, after: { quantity: 4, unit: '미' } }],
});

test('수정한 줄은 수정 뒤 값 그대로일 때만 이전 값으로 돌린다', () => {
  const ok = planUndo(changed('modified'), map(cur({ id: 'c1', quantity: 4, change_status: 'modified' })), noMemos);
  assert.deepEqual(ok.conflicts, []);
  assert.equal(ok.restoreItems.length, 1);
  assert.equal(ok.restoreItems[0].before.quantity, 2);
  const edited = planUndo(changed('modified'), map(cur({ id: 'c1', quantity: 7, change_status: 'modified' })), noMemos);
  assert.equal(edited.conflicts.length, 1);
  const packed = planUndo(changed('modified'), map(cur({ id: 'c1', quantity: 4, change_status: 'modified', is_packed: true })), noMemos);
  assert.equal(packed.conflicts.length, 1);
});

test('이미 수정 전 값으로 돌아온 줄은 건너뛴다(재시도)', () => {
  const plan = planUndo(changed('modified'), map(cur({ id: 'c1', quantity: 2, change_status: 'none' })), noMemos);
  assert.deepEqual([plan.conflicts, plan.restoreItems], [[], []]);
});

test('취소했던 줄은 아직 취소 상태일 때만 되살린다', () => {
  assert.equal(planUndo(changed('cancelled'), map(cur({ id: 'c1', change_status: 'cancelled' })), noMemos).restoreItems.length, 1);
  assert.equal(planUndo(changed('cancelled'), map(cur({ id: 'c1', change_status: 'none' })), noMemos).restoreItems.length, 0);
});

test('메모는 입력이 바꾼 그대로일 때만 이전 메모로 돌리고, 그 뒤에 바뀌었으면 건드리지 않는다', () => {
  const e: InputEffects = { ...emptyEffects(), memos: [{ dailyBusinessId: 'card1', before: null, after: '급함' }] };
  assert.equal(planUndo(e, new Map(), new Map([['card1', { dailyBusinessId: 'card1', memo: '급함' }]])).restoreMemos.length, 1);
  const edited = planUndo(e, new Map(), new Map([['card1', { dailyBusinessId: 'card1', memo: '다른 메모' }]]));
  assert.equal(edited.restoreMemos.length, 0);
  assert.deepEqual(edited.conflicts, []);
});

test('일부가 충돌이면 충돌 목록을 모두 알린다(일부만 되돌리지 않도록 호출하는 쪽이 전체를 중단한다)', () => {
  const e: InputEffects = {
    ...emptyEffects(),
    createdItems: [
      { id: 'n1', dailyBusinessId: 'card1', productName: '광어', quantity: 3, unit: '미' },
      { id: 'n2', dailyBusinessId: 'card1', productName: '우럭', quantity: 2, unit: '미' },
    ],
  };
  const plan = planUndo(e, map(cur({ id: 'n1', is_packed: true }), cur({ id: 'n2', product_name_raw: '우럭', quantity: 2 })), noMemos);
  assert.equal(plan.conflicts.length, 1);
  assert.deepEqual(plan.cancelItemIds, ['n2']); // 계획에는 남지만 충돌이 있으면 실행하지 않는다
});

test('요약과 저장 형식 검사', () => {
  const e = effects();
  assert.deepEqual(summarizeEffects(e), { newItems: 1, modifiedItems: 0, cancelledItems: 0, newCards: 1 });
  assert.equal(parseEffects(e) !== null, true);
  assert.equal(parseEffects({ version: 2 }), null);
  assert.equal(parseEffects(null), null);
  assert.equal(parseEffects('x'), null);
});
