import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShippingRows, parseShippingMethod, shippingInputError, shippingTotals, shippingUnitPrice, suggestAmount, type ShippingCard, type StoredShipping } from './settlement/shipping.ts';
import { attachShippingLines, buildSnapshot, groupForReceipts, shippingReceiptRow, type ReceiptSeller, type ReceiptSourceRow } from './settlement/receipt.ts';

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const SELLER = '33333333-3333-4333-8333-333333333333';

const card = (over: Partial<ShippingCard> = {}): ShippingCard => ({
  cardId: CARD_A,
  orderDate: '2026-11-13',
  customer: '가고객',
  terminal: '동서울',
  quickAllowed: true,
  boxes: 3,
  rates: { bus: 10000, quick: 5000, parcel: null },
  sellerId: SELLER,
  ...over,
});
const stored = (over: Partial<StoredShipping> = {}): StoredShipping => ({ id: 's1', cardId: CARD_A, method: 'bus', boxes: 3, amount: 25000, sellerId: null, paid: false, memo: null, ...over });

test('suggestAmount: 박스 수 × 박스당 금액', () => {
  assert.equal(suggestAmount(10000, 3), 30000);
  assert.equal(suggestAmount(2500, 0), 0);
});

test('buildShippingRows: 금액이 있는 수단만 제안하고 수단 순서(버스·퀵·택배)를 지킨다', () => {
  const rows = buildShippingRows([card()], []);
  assert.deepEqual(rows.map((r) => [r.method, r.boxes, r.amount, r.saved, r.sellerId]), [
    ['bus', 3, 30000, false, SELLER],
    ['quick', 3, 15000, false, SELLER],
  ]);
});

test('buildShippingRows: 터미널이 퀵 불가면 퀵을 제안하지 않는다', () => {
  const rows = buildShippingRows([card({ quickAllowed: false })], []);
  assert.deepEqual(rows.map((r) => r.method), ['bus']);
});

test('buildShippingRows: 박스가 0개이거나 설정이 없는 고객은 제안하지 않는다', () => {
  assert.equal(buildShippingRows([card({ boxes: 0 })], []).length, 0);
  assert.equal(buildShippingRows([card({ rates: { bus: null, quick: null, parcel: null } })], []).length, 0);
});

test('buildShippingRows: 저장한 줄이 제안을 대신하고, 사업자가 비면 판매 줄 사업자를 따른다', () => {
  const rows = buildShippingRows([card()], [stored()]);
  const bus = rows.find((r) => r.method === 'bus')!;
  assert.equal(bus.saved, true);
  assert.equal(bus.amount, 25000);
  assert.equal(bus.sellerId, SELLER);
  assert.equal(rows.filter((r) => r.method === 'bus').length, 1);
  assert.equal(rows.find((r) => r.method === 'quick')!.saved, false);
});

test('buildShippingRows: 퀵 불가 터미널에 이미 저장된 퀵은 지우지 않고 표시만 한다', () => {
  const rows = buildShippingRows([card({ quickAllowed: false })], [stored({ method: 'quick', amount: 12000 })]);
  const quick = rows.find((r) => r.method === 'quick')!;
  assert.equal(quick.saved, true);
  assert.equal(quick.quickBlocked, true);
});

test('buildShippingRows: 출고일 → 고객명(가나다) 순으로 정렬한다', () => {
  const rows = buildShippingRows(
    [card({ cardId: CARD_B, customer: '나고객', orderDate: '2026-11-13' }), card({ customer: '가고객', orderDate: '2026-11-14' }), card({ cardId: '44444444-4444-4444-8444-444444444444', customer: '가고객', orderDate: '2026-11-13' })],
    [],
  );
  assert.deepEqual(rows.filter((r) => r.method === 'bus').map((r) => `${r.orderDate} ${r.customer}`), ['2026-11-13 가고객', '2026-11-13 나고객', '2026-11-14 가고객']);
});

test('shippingTotals: 저장한 줄만 합계에 넣고 제안 줄은 따로 센다', () => {
  const totals = shippingTotals(buildShippingRows([card()], [stored({ paid: true })]));
  assert.deepEqual(totals, { rows: 2, total: 25000, suggested: 1, unpaid: 0 });
});

test('shippingUnitPrice: 나눠떨어질 때만 단가를 돌려준다', () => {
  assert.equal(shippingUnitPrice(30000, 3), 10000);
  assert.equal(shippingUnitPrice(20000, 3), null);
  assert.equal(shippingUnitPrice(5000, 0), null);
});

test('parseShippingMethod: 한글 이름과 키를 모두 받는다', () => {
  assert.equal(parseShippingMethod(' 버스 '), 'bus');
  assert.equal(parseShippingMethod('quick'), 'quick');
  assert.equal(parseShippingMethod('택배'), 'parcel');
  assert.equal(parseShippingMethod('운임'), null);
});

test('shippingInputError: 형식·범위를 검사한다', () => {
  const ok = { cardId: CARD_A, method: 'bus', boxes: 2, amount: 20000, sellerId: null, paid: false, memo: null };
  assert.equal(shippingInputError(ok), null);
  assert.notEqual(shippingInputError({ ...ok, cardId: 'x' }), null);
  assert.notEqual(shippingInputError({ ...ok, method: '운임' }), null);
  assert.notEqual(shippingInputError({ ...ok, boxes: -1 }), null);
  assert.notEqual(shippingInputError({ ...ok, boxes: 1.5 }), null);
  assert.notEqual(shippingInputError({ ...ok, amount: -5 }), null);
  assert.notEqual(shippingInputError({ ...ok, memo: 'a'.repeat(501) }), null);
});

// ── 영수증 ─────────────────────────────────────────────────────────────────

const sale = (over: Partial<ReceiptSourceRow> = {}): ReceiptSourceRow => ({ itemId: 'i1', orderDate: '2026-11-13', customer: '가고객', product: '광어', quantity: 2, unit: 'kg', sellerId: SELLER, price: 40000, unitPrice: 20000, ...over });
const seller: ReceiptSeller = { name: '통영아재수산', registrationNo: '1234567890', representative: null, address: null, businessType: null, businessItem: null };

test('shippingReceiptRow: 저장하지 않은 제안·0원 줄은 영수증에 넣지 않는다', () => {
  const [suggested, saved] = buildShippingRows([card()], [stored({ method: 'quick', amount: 0 })]).filter((r) => r.method !== 'quick' || r.saved).concat([]);
  assert.equal(shippingReceiptRow(suggested), null); // 제안(버스)
  assert.equal(shippingReceiptRow(saved), null); // 저장했지만 0원(퀵)
});

test('attachShippingLines: 같은 고객·사업자·출고일 묶음의 맨 뒤에 배송비 줄이 붙고 합계에 들어간다', () => {
  const rows = buildShippingRows([card()], [stored({ amount: 30000 })]);
  const ship = rows.map(shippingReceiptRow).filter((r): r is ReceiptSourceRow => r !== null);
  assert.equal(ship.length, 1);
  const { groups } = groupForReceipts([sale()]);
  const withShipping = attachShippingLines(groups, ship);
  assert.equal(withShipping[0].rows.length, 2);
  const snapshot = buildSnapshot(withShipping[0], seller);
  assert.deepEqual(snapshot.lines[1], { product: '버스', quantity: 3, unit: '박스', unitPrice: 10000, amount: 30000 });
  assert.equal(snapshot.total, 70000);
});

test('attachShippingLines: 판매 줄이 없는 고객의 배송비는 영수증을 만들지 않고, 다른 고객 묶음에는 붙지 않는다', () => {
  const ship = buildShippingRows([card({ customer: '나고객' })], [stored({ amount: 30000 })]).map(shippingReceiptRow).filter((r): r is ReceiptSourceRow => r !== null);
  const { groups } = groupForReceipts([sale()]);
  const result = attachShippingLines(groups, ship);
  assert.equal(result.length, 1);
  assert.equal(result[0].rows.length, 1);
});

test('attachShippingLines: 사업자를 알 수 없는 배송비 줄은 붙이지 않는다', () => {
  const ship = buildShippingRows([card({ sellerId: null })], [stored({ amount: 30000 })]).map(shippingReceiptRow).filter((r): r is ReceiptSourceRow => r !== null);
  const { groups } = groupForReceipts([sale()]);
  assert.equal(attachShippingLines(groups, ship)[0].rows.length, 1);
});
