import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountFromUnitPrice,
  buildSnapshot,
  canAutoFillPrice,
  findDuplicateReceipts,
  formatQuantity,
  groupForReceipts,
  pageNumberLabel,
  parseSnapshot,
  receiptFileName,
  splitPages,
  type ReceiptSeller,
  type ReceiptSourceRow,
} from './settlement/receipt.ts';

const row = (over: Partial<ReceiptSourceRow> & { itemId: string }): ReceiptSourceRow => ({
  orderDate: '2026-11-14',
  customer: '엔야',
  product: '광어',
  quantity: 1,
  unit: '미',
  sellerId: 'seller-a',
  price: 1000,
  unitPrice: null,
  ...over,
});

const seller: ReceiptSeller = { name: '테스트수산', registrationNo: '1234567890', representative: '홍길동', address: '경남 통영시', businessType: '도매', businessItem: '수산물' };

test('rows are grouped by date, seller and customer', () => {
  const { groups, skipped } = groupForReceipts([
    row({ itemId: '1' }),
    row({ itemId: '2', product: '전복' }),
    row({ itemId: '3', sellerId: 'seller-b' }),
    row({ itemId: '4', customer: '신라호텔' }),
    row({ itemId: '5', orderDate: '2026-11-13' }),
  ]);
  assert.equal(skipped.length, 0);
  assert.equal(groups.length, 4);
  const enya = groups.find((g) => g.customer === '엔야' && g.sellerId === 'seller-a' && g.orderDate === '2026-11-14');
  assert.deepEqual(enya?.rows.map((r) => r.itemId), ['1', '2']);
});

test('groups are sorted by date then customer name', () => {
  const { groups } = groupForReceipts([
    row({ itemId: '1', orderDate: '2026-11-14', customer: '하' }),
    row({ itemId: '2', orderDate: '2026-11-14', customer: '가' }),
    row({ itemId: '3', orderDate: '2026-11-13', customer: '나' }),
  ]);
  assert.deepEqual(groups.map((g) => `${g.orderDate} ${g.customer}`), ['2026-11-13 나', '2026-11-14 가', '2026-11-14 하']);
});

test('rows without a seller or a price are skipped with a reason', () => {
  const { groups, skipped } = groupForReceipts([
    row({ itemId: '1', sellerId: null }),
    row({ itemId: '2', price: null }),
    row({ itemId: '3', sellerId: null, price: null }),
    row({ itemId: '4', price: 0 }),
  ]);
  assert.deepEqual(skipped.map((s) => [s.row.itemId, s.reason]), [['1', 'no-seller'], ['2', 'no-price'], ['3', 'no-seller']]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows[0].itemId, '4');
});

test('snapshot keeps line amounts as the entered sale price and sums the total', () => {
  const { groups } = groupForReceipts([
    row({ itemId: '1', quantity: 5, unit: '미', price: 25000, unitPrice: 5000 }),
    row({ itemId: '2', product: '전복', quantity: 2.5, unit: 'kg', price: 40000, unitPrice: null }),
  ]);
  const snap = buildSnapshot(groups[0], seller);
  assert.equal(snap.total, 65000);
  assert.deepEqual(snap.lines.map((l) => [l.product, l.amount, l.unitPrice]), [['광어', 25000, 5000], ['전복', 40000, null]]);
  assert.equal(snap.customerName, '엔야');
  assert.equal(snap.seller.name, '테스트수산');
  assert.equal(snap.version, 1);
});

test('splitPages splits at 15 rows and never returns zero pages', () => {
  const items = Array.from({ length: 31 }, (_, i) => i);
  assert.deepEqual(splitPages(items).map((p) => p.length), [15, 15, 1]);
  assert.deepEqual(splitPages(items.slice(0, 15)).map((p) => p.length), [15]);
  assert.deepEqual(splitPages([]), [[]]);
});

test('page number label adds a suffix only when the receipt has several pages', () => {
  assert.equal(pageNumberLabel(7, 0, 1), '7');
  assert.equal(pageNumberLabel(7, 0, 2), '7-1');
  assert.equal(pageNumberLabel(7, 1, 2), '7-2');
});

test('formatQuantity trims trailing zeros', () => {
  assert.equal(formatQuantity(5, '미'), '5미');
  assert.equal(formatQuantity(2.5, 'kg'), '2.5kg');
  assert.equal(formatQuantity(0.30000000000000004, 'kg'), '0.3kg');
});

test('amountFromUnitPrice rounds to whole won', () => {
  assert.equal(amountFromUnitPrice(5000, 5), 25000);
  assert.equal(amountFromUnitPrice(3333, 1.5), 5000); // 4999.5 → 5000
  assert.equal(amountFromUnitPrice(1000, 0.1), 100);
});

test('receiptFileName removes characters that are invalid in file names', () => {
  assert.equal(receiptFileName('2026-11-14', '엔야'), '영수증_2026-11-14_엔야.png');
  assert.equal(receiptFileName('2026-11-14', '신라/호텔:본점'), '영수증_2026-11-14_신라호텔본점.png');
  assert.equal(receiptFileName('2026-11-14', '엔야', 1, 3), '영수증_2026-11-14_엔야_2.png');
  assert.equal(receiptFileName('2026-11-14', '///'), '영수증_2026-11-14_고객.png');
});

test('parseSnapshot round-trips a snapshot through JSON', () => {
  const { groups } = groupForReceipts([row({ itemId: '1', quantity: 2.5, unit: 'kg', price: 40000, unitPrice: 16000 })]);
  const snap = buildSnapshot(groups[0], seller);
  assert.deepEqual(parseSnapshot(JSON.parse(JSON.stringify(snap))), snap);
});

test('parseSnapshot rejects malformed values instead of throwing', () => {
  const { groups } = groupForReceipts([row({ itemId: '1' })]);
  const good = JSON.parse(JSON.stringify(buildSnapshot(groups[0], seller)));
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot('text'), null);
  assert.equal(parseSnapshot({ ...good, version: 2 }), null);
  assert.equal(parseSnapshot({ ...good, total: '1000' }), null);
  assert.equal(parseSnapshot({ ...good, seller: null }), null);
  assert.equal(parseSnapshot({ ...good, seller: { ...good.seller, name: 5 } }), null);
  assert.equal(parseSnapshot({ ...good, lines: [{ product: '광어' }] }), null);
  assert.equal(parseSnapshot({ ...good, lines: 'x' }), null);
});

test('canAutoFillPrice only fills an empty or auto-computed sale price', () => {
  assert.equal(canAutoFillPrice(null, null, 5), true); // 판매가 비어 있음
  assert.equal(canAutoFillPrice(25000, 5000, 5), true); // 이전 단가 × 수량으로 자동 계산된 값
  assert.equal(canAutoFillPrice(20000, 5000, 5), false); // 사용자가 따로 적은 할인가
  assert.equal(canAutoFillPrice(25000, null, 5), false); // 단가 없이 직접 적은 판매가
  assert.equal(canAutoFillPrice(0, null, 5), false); // 0원도 직접 적은 값이다
});

test('findDuplicateReceipts matches by date, customer and seller', () => {
  const { groups } = groupForReceipts([
    row({ itemId: '1' }),
    row({ itemId: '2', customer: '신라호텔' }),
    row({ itemId: '3', sellerId: 'seller-b' }),
  ]);
  const issued = [
    { orderDate: '2026-11-14', customerName: '엔야', sellerId: 'seller-a', receiptNo: 3 },
    { orderDate: '2026-11-14', customerName: '엔야', sellerId: 'seller-a', receiptNo: 1 },
    { orderDate: '2026-11-13', customerName: '신라호텔', sellerId: 'seller-a', receiptNo: 9 }, // 다른 날짜
  ];
  const found = findDuplicateReceipts(groups, issued);
  const enya = groups.find((g) => g.customer === '엔야' && g.sellerId === 'seller-a')!;
  assert.deepEqual(found.get(enya.key), [1, 3]);
  assert.equal(found.size, 1);
});
