import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessIdsInBothRounds, getProductCustomers, getProductSummary, isCardCancelled, nameWithRound, roundLabel, type OrderItem } from './orders.ts';

test('1·2차가 둘 다 있는 업체만 이름에 차수를 붙인다', () => {
  const split = businessIdsInBothRounds([
    { businessId: 'a', round: 1 },
    { businessId: 'a', round: 2 },
    { businessId: 'b', round: 1 },
    { businessId: 'c', round: 2 },
  ]);
  assert.deepEqual([...split], ['a']);
  assert.equal(nameWithRound('바다향횟집', 1, split.has('a')), '바다향횟집 1차');
  assert.equal(nameWithRound('바다향횟집', 2, split.has('a')), '바다향횟집 2차');
  assert.equal(nameWithRound('청해수산', 1, split.has('b')), '청해수산');
  assert.equal(nameWithRound('갯마을수산', 2, split.has('c')), '갯마을수산');
});

test('차수 값이 이상하면 1차로 본다', () => {
  assert.equal(nameWithRound('x', 0, true), 'x 1차');
  assert.equal(nameWithRound('x', 3, true), 'x 1차');
  assert.equal(roundLabel(2), '2차');
});

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: 'i', dailyBusinessId: 'd1', businessId: 'b1', businessName: '가게', terminal: '대구', businessNumber: 1, productSequence: 1,
  productId: null, productName: '활전갱이', quantity: 2, unit: '미', isMulbong: false, hasAerator: false, isPacked: false,
  unshippedQuantity: 0, changeStatus: 'none', ...over,
});
const undecided = (over: Partial<OrderItem> = {}) => item({ quantity: 0, unit: '', ...over });

test('품목별 수량: 수량 미정뿐인 품목도 "미정" 줄로 나온다', () => {
  const rows = getProductSummary([item({ productName: '방어', quantity: 3 }), undecided({ productName: '문어다리', dailyBusinessId: 'd2' })]);
  assert.deepEqual(rows.map((r) => ({ label: r.label, total: r.total, unit: r.unit, undecided: r.undecided })), [
    { label: '문어다리', total: 0, unit: '', undecided: 1 },
    { label: '방어', total: 3, unit: '미', undecided: 0 },
  ]);
});

test('품목별 수량: 확정 줄이 있는 품목은 확정 줄 뒤에 미정 줄이 따로 붙는다', () => {
  const rows = getProductSummary([item({ quantity: 4 }), item({ id: 'j', dailyBusinessId: 'd2', quantity: 8 }), undecided({ id: 'k', dailyBusinessId: 'd3' })]);
  assert.deepEqual(rows.map((r) => [r.label, r.total, r.unit, r.undecided]), [
    ['활전갱이', 12, '미', 0],
    ['활전갱이', 0, '', 1],
  ]);
});

test('품목별 수량: 미정은 고객 수로 센다(같은 고객의 같은 품목 미정 두 줄은 1곳, 취소는 제외)', () => {
  const rows = getProductSummary([
    undecided({ id: 'a', dailyBusinessId: 'd1' }),
    undecided({ id: 'b', dailyBusinessId: 'd1' }),
    undecided({ id: 'c', dailyBusinessId: 'd2' }),
    undecided({ id: 'd', dailyBusinessId: 'd3', changeStatus: 'cancelled' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].undecided, 2);
});

test('품목별 수량: 사이즈·준비 방식이 다르면 미정 줄도 따로 센다', () => {
  const rows = getProductSummary([undecided({ sizeRequest: '선별' }), undecided({ id: 'x', dailyBusinessId: 'd2', isMulbong: true })]);
  assert.deepEqual(rows.map((r) => [r.label, r.undecided]).sort(), [['활전갱이 (선별)', 1], ['활전갱이 · 물봉', 1]]);
});

test('품목별 수량: 미정이 없으면 이전과 같은 결과다(undecided는 모두 0)', () => {
  const rows = getProductSummary([item({ quantity: 2 }), item({ id: 'n', dailyBusinessId: 'd2', productName: '방어', quantity: 1, unit: 'kg' })]);
  assert.deepEqual(rows.map((r) => [r.label, r.total, r.unit, r.undecided]), [['방어', 1, 'kg', 0], ['활전갱이', 2, '미', 0]]);
});

test('품목별 수량: 추가분은 첫 입력 이후 추가된 품목(new)만이며 전체에 포함되고 취소·미출고는 뺀다', () => {
  const rows = getProductSummary([
    item({ id: 'a', quantity: 10 }),
    item({ id: 'b', dailyBusinessId: 'd2', quantity: 5, changeStatus: 'new' }),
    item({ id: 'c', dailyBusinessId: 'd3', quantity: 4, unshippedQuantity: 1, changeStatus: 'new' }),
    item({ id: 'd', dailyBusinessId: 'd4', quantity: 7, changeStatus: 'cancelled' }),
    item({ id: 'e', dailyBusinessId: 'd5', quantity: 3, changeStatus: 'modified' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 21); // 10 + 5 + 3(4-1) + 3, 취소 제외
  assert.equal(rows[0].added, 8); // new 두 줄: 5 + (4-1)
});

test('품목별 수량: 추가된 품목이 없으면 추가분은 0이다', () => {
  assert.equal(getProductSummary([item({ quantity: 2 }), undecided({ id: 'u', dailyBusinessId: 'd2', changeStatus: 'new' })]).every((r) => r.added === 0), true);
});

test('품목별 고객 목록: 고객마다 이 품목의 줄(id·수량·포장 여부)을 돌려준다', () => {
  const items = [
    item({ id: 'a1', dailyBusinessId: 'd1', businessName: '가', quantity: 3, isPacked: true }),
    item({ id: 'a2', dailyBusinessId: 'd1', businessName: '가', quantity: 2, isPacked: false }), // 같은 품목이 두 줄
    item({ id: 'b1', dailyBusinessId: 'd2', businessName: '나', quantity: 4, isPacked: true }),
    item({ id: 'c1', dailyBusinessId: 'd3', businessName: '다', productName: '방어', quantity: 1 }), // 다른 품목
    item({ id: 'x1', dailyBusinessId: 'd2', businessName: '나', quantity: 9, changeStatus: 'cancelled' }), // 취소는 제외
  ];
  const key = getProductSummary(items).find((r) => r.productName === '활전갱이')!.key;
  const list = getProductCustomers(items, { key }, new Map([['d2', 0], ['d1', 1]]));
  assert.deepEqual(list.map((c) => [c.name, c.quantity, c.allPacked]), [['나', 4, true], ['가', 5, false]]);
  assert.deepEqual(list[0].lines, [{ id: 'b1', quantity: 4, isPacked: true }]);
  assert.deepEqual(list[1].lines.map((l) => l.id), ['a1', 'a2']);
});

test('고객사 취소: 상품이 하나 이상이고 전부 취소일 때만 취소된 고객사다', () => {
  assert.equal(isCardCancelled([item({ changeStatus: 'cancelled' }), item({ changeStatus: 'cancelled' })]), true);
  assert.equal(isCardCancelled([item({ changeStatus: 'cancelled' }), item({ changeStatus: 'none' })]), false);
  assert.equal(isCardCancelled([item({ changeStatus: 'modified' })]), false);
  assert.equal(isCardCancelled([]), false); // 빈 카드는 취소가 아니다
});
