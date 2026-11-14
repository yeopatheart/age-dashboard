import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups, editLine, editLineCells, editShipping, editShippingCells, groupTotals, isMultiCell, parseClipboard } from './settlement/sheet.ts';
import type { SalesRow } from './settlement/sales.ts';
import type { ShippingRow } from './settlement/shipping.ts';

const line = (over: Partial<SalesRow> = {}): SalesRow => ({
  itemId: 'i1', cardId: 'c1', orderDate: '2026-11-14', customer: '가고객', product: '활전갱이', quantity: 4, unit: '미',
  original: { product: '활전갱이', quantity: 4, unit: '미' }, edited: false, terminal: '동서울', secondaryWeightKg: null,
  sellerId: 's1', price: null, unitPrice: null, paid: false, memo: '', ...over,
});
const ship = (over: Partial<ShippingRow> = {}): ShippingRow => ({
  key: 'c1|bus', cardId: 'c1', orderDate: '2026-11-14', customer: '가고객', terminal: '동서울', method: 'bus', boxes: 2, rate: 10000, amount: 20000,
  saved: false, sellerId: 's1', paid: false, memo: '', quickBlocked: false, ...over,
});

test('buildGroups: 카드별로 상품 줄과 배송비 줄을 묶고, 배송비만 있는 카드는 뒤에 둔다', () => {
  const groups = buildGroups([line(), line({ itemId: 'i2', cardId: 'c2', customer: '나고객' }), line({ itemId: 'i3' })], [ship(), ship({ key: 'c3|bus', cardId: 'c3', customer: '다고객' })]);
  assert.deepEqual(groups.map((g) => [g.customer, g.lines.length, g.shipping.length]), [['가고객', 2, 1], ['나고객', 1, 0], ['다고객', 0, 1]]);
});

test('groupTotals: 상품 합계 + 배송비(자동 산정 포함), 판매가 미입력 줄 수', () => {
  const [g] = buildGroups([line({ price: 30000 }), line({ itemId: 'i2' })], [ship()]);
  assert.deepEqual(groupTotals(g), { goods: 30000, shipping: 20000, total: 50000, unpriced: 1 });
});

test('editLine: 실중량을 적으면 수량 수정값이 되고, 단가가 있으면 판매가를 다시 계산한다', () => {
  const r = line({ unitPrice: 28000, price: 112000 }); // 28000 × 4 = 자동 계산된 값 그대로
  const edit = editLine(r, 'quantity', '1.1');
  assert.deepEqual(edit, { fields: { quantity: 1.1, price: 30800 }, view: { quantity: 1.1, price: 30800, edited: true } });
});

test('editLine: 직접 적은 판매가(보정)는 수량·단가를 고쳐도 건드리지 않는다', () => {
  const r = line({ unitPrice: 28000, price: 31000 });
  assert.deepEqual(editLine(r, 'quantity', '1.1'), { fields: { quantity: 1.1 }, view: { quantity: 1.1, edited: true } });
  assert.deepEqual(editLine(r, 'unitPrice', '30,000'), { fields: { unitPrice: 30000 }, view: { unitPrice: 30000 } });
});

test('editLine: 단가를 적으면 비어 있는 판매가를 단가 × 수량으로 채운다', () => {
  assert.deepEqual(editLine(line({ quantity: 1.1 }), 'unitPrice', '₩28,000'), { fields: { unitPrice: 28000, price: 30800 }, view: { unitPrice: 28000, price: 30800 } });
});

test('editLine: 비우면 품목·수량·단위는 주문 목록 값으로 되돌리고, 단가·판매가는 지운다', () => {
  const edited = line({ product: '전갱이', quantity: 1.1, unit: 'kg', edited: true, price: 500 });
  assert.deepEqual(editLine(edited, 'product', ''), { fields: { product: null }, view: { product: '활전갱이', edited: true } });
  assert.deepEqual(editLine(edited, 'price', ''), { fields: { price: null }, view: { price: null } });
  assert.equal(editLine(line(), 'quantity', ''), null); // 이미 주문 목록 값
});

test('editLine: 같은 값은 변경 없음(null), 잘못된 값은 오류', () => {
  assert.equal(editLine(line(), 'product', ' 활전갱이 '), null);
  assert.equal(editLine(line({ memo: 'a' }), 'memo', 'a'), null);
  assert.ok('error' in (editLine(line(), 'quantity', 'abc') ?? {}));
  assert.ok('error' in (editLine(line(), 'quantity', '1.234') ?? {}));
  assert.ok('error' in (editLine(line(), 'price', '1.5') ?? {}));
  assert.ok('error' in (editLine(line(), 'unit', '열한글자가넘는단위이름') ?? {}));
});

test('editShipping: 자동 산정 줄의 박스 수를 고치면 금액도 다시 계산하고, 저장한 줄은 금액을 그대로 둔다', () => {
  const auto = editShipping(ship(), 'quantity', '3');
  assert.ok(auto && 'next' in auto);
  assert.deepEqual([auto.next.boxes, auto.next.amount, auto.next.saved], [3, 30000, true]);
  const saved = editShipping(ship({ saved: true, amount: 25000 }), 'quantity', '3');
  assert.ok(saved && 'next' in saved);
  assert.equal(saved.next.amount, 25000);
});

test('editShipping: 금액을 비우면 0원(그날 뺌), 배송비 줄에 없는 칸은 무시', () => {
  const cleared = editShipping(ship(), 'price', '');
  assert.ok(cleared && 'next' in cleared);
  assert.equal(cleared.next.amount, 0);
  assert.equal(editShipping(ship(), 'product', '무엇'), null);
  assert.equal(editShipping(ship(), 'unitPrice', '100'), null);
  assert.ok('error' in (editShipping(ship(), 'quantity', '1.5') ?? {}));
});

test('editShipping: 자동 산정 줄에 같은 금액을 적어도 저장(확정)한다', () => {
  const same = editShipping(ship(), 'price', '20,000');
  assert.ok(same && 'next' in same);
  assert.equal(same.next.saved, true);
  assert.equal(editShipping(ship({ saved: true }), 'price', '20,000'), null);
});

test('parseClipboard: 탭·줄바꿈으로 나누고 끝의 빈 줄을 뺀다', () => {
  assert.deepEqual(parseClipboard('1.1\t28000\r\n2.3\t30000\r\n'), [['1.1', '28000'], ['2.3', '30000']]);
  assert.equal(isMultiCell('30000'), false);
  assert.equal(isMultiCell('30000\n'), false);
  assert.equal(isMultiCell('1\t2'), true);
  assert.equal(isMultiCell('1\n2\n'), true);
});

test('editLineCells: 수량과 단가를 같이 붙여넣으면 판매가가 새 수량 × 새 단가로 계산된다', () => {
  const edit = editLineCells(line(), [['quantity', '1.1'], ['unit', 'kg'], ['unitPrice', '28000']]);
  assert.ok(edit && 'fields' in edit);
  assert.deepEqual(edit.fields, { quantity: 1.1, unit: 'kg', unitPrice: 28000, price: 30800 });
  assert.equal(edit.view.edited, true);
  assert.equal(editLineCells(line(), [['product', '활전갱이'], ['memo', '']]), null);
  assert.ok('error' in (editLineCells(line(), [['quantity', '1.1'], ['price', 'x']]) ?? {}));
});

test('editShippingCells: 박스 수와 금액을 같이 붙여넣으면 적은 금액이 남는다', () => {
  const edit = editShippingCells(ship(), [['quantity', '3'], ['unit', '박스'], ['price', '25000']]);
  assert.ok(edit && 'next' in edit);
  assert.deepEqual([edit.next.boxes, edit.next.amount], [3, 25000]);
});
