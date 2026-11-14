import test from 'node:test';
import assert from 'node:assert/strict';
import { COL, planChangeCount, planImport, type ImportContext, type ParsedWorkbook, type RawRow } from './settlement/excel-import.ts';
import type { SalesRow } from './settlement/sales.ts';
import type { PurchaseRow } from './settlement/purchases.ts';
import type { ShippingCard, ShippingRow } from './settlement/shipping.ts';
import ExcelJS from 'exceljs';
import { buildSettlementDayWorkbook, parseSettlementDayWorkbook } from './export/settlement-day.ts';

const DATE = '2026-11-14';
const CARD = '11111111-1111-4111-8111-111111111111';
const SELLER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELLER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUPPLIER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sale = (over: Partial<SalesRow> = {}): SalesRow => ({
  itemId: 'item-1',
  orderDate: DATE,
  customer: '가고객',
  product: '광어',
  quantity: 3,
  unit: 'kg',
  original: { product: '광어', quantity: 3, unit: 'kg' },
  edited: false,
  terminal: '동서울',
  secondaryWeightKg: null,
  sellerId: SELLER_A,
  price: null,
  unitPrice: null,
  paid: false,
  memo: '',
  ...over,
});
const ship = (over: Partial<ShippingRow> = {}): ShippingRow => ({
  key: `${CARD}|bus`,
  cardId: CARD,
  orderDate: DATE,
  customer: '가고객',
  terminal: '동서울',
  method: 'bus',
  boxes: 3,
  rate: 10000,
  amount: 30000,
  saved: false,
  sellerId: SELLER_A,
  paid: false,
  memo: '',
  quickBlocked: false,
  ...over,
});
const card = (over: Partial<ShippingCard> = {}): ShippingCard => ({ cardId: CARD, orderDate: DATE, customer: '가고객', terminal: '동서울', quickAllowed: true, boxes: 3, rates: { bus: 10000, quick: null, parcel: null }, sellerId: SELLER_A, ...over });
const purchase = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({ key: `${DATE}|광어`, orderDate: DATE, product: '광어', sellerId: null, supplierId: null, price: null, paid: false, memo: '', salesTotal: 0, salesCount: 1, salesPriced: 0, ...over });

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  date: DATE,
  sales: [sale()],
  shipping: { rows: [ship()], cards: [card()] },
  purchases: [purchase()],
  sellers: [{ id: SELLER_A, name: '열두달수산' }, { id: SELLER_B, name: '바른수산' }],
  suppliers: [{ id: SUPPLIER, name: '통영수산' }],
  ...over,
});
const row = (n: number, cells: RawRow['cells']): RawRow => ({ row: n, cells });
const book = (over: Partial<ParsedWorkbook> = {}): ParsedWorkbook => ({ date: DATE, sales: null, shipping: null, purchases: null, ...over });

test('날짜가 없거나 다르면 아무것도 계획하지 않고 오류만 낸다', () => {
  assert.equal(planImport(ctx(), book({ date: null })).errors.length, 1);
  const other = planImport(ctx(), book({ date: '2026-11-13', sales: [row(2, { [COL.key]: 'item-1', [COL.price]: 5000 })] }));
  assert.equal(other.errors.length, 1);
  assert.equal(planChangeCount(other), 0);
});

test('판매: 바뀐 칸만 변경으로 잡고, 빈 칸과 같은 값은 건너뛴다', () => {
  const plan = planImport(ctx(), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.product]: '광어', [COL.quantity]: 3, [COL.unitPrice]: '1,500', [COL.price]: 4500, [COL.paid]: 'y', [COL.memo]: null })] }));
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.sales.length, 1);
  assert.deepEqual(plan.sales[0].fields, { unitPrice: 1500, price: 4500, paid: true });
});

test('판매: 품목·수량·단위는 원본과 다르면 수정값, 원본과 같아지면 null(되돌림)', () => {
  const edited = sale({ product: '참돔', quantity: 5, unit: '미', edited: true });
  const plan = planImport(ctx({ sales: [edited] }), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.product]: '광어', [COL.quantity]: 3, [COL.unit]: 'kg' })] }));
  assert.deepEqual(plan.sales[0].fields, { product: null, quantity: null, unit: null });
  const change = planImport(ctx(), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.product]: '농어', [COL.quantity]: 2.5, [COL.unit]: '미' })] }));
  assert.deepEqual(change.sales[0].fields, { product: '농어', quantity: 2.5, unit: '미' });
});

test('판매: 사업자구분은 이름으로 찾고 모르는 이름은 오류, 미지정은 null', () => {
  const ok = planImport(ctx(), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.seller]: '바른수산' })] }));
  assert.equal(ok.sales[0].fields.sellerId, SELLER_B);
  const unset = planImport(ctx(), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.seller]: '미지정' })] }));
  assert.equal(unset.sales[0].fields.sellerId, null);
  const bad = planImport(ctx(), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.seller]: '없는수산' })] }));
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.errors[0].row, 2);
});

test('판매: 숫자 형식·범위 오류와 모르는 키·빈 키·중복 키는 오류로 모은다', () => {
  const plan = planImport(
    ctx(),
    book({
      sales: [
        row(2, { [COL.key]: 'item-1', [COL.price]: 'abc' }),
        row(3, { [COL.key]: 'item-1', [COL.price]: 100 }),
        row(4, { [COL.key]: 'nope', [COL.price]: 100 }),
        row(5, { [COL.key]: '', [COL.price]: 100 }),
        row(6, { [COL.key]: 'item-1', [COL.quantity]: 0 }),
      ],
    }),
  );
  assert.equal(planChangeCount(plan), 0);
  assert.ok(plan.errors.length >= 4);
});

test('배송비: 제안 줄은 값을 고쳤을 때만 처음 저장되고, 고치지 않으면 건너뛴다', () => {
  const same = planImport(ctx(), book({ shipping: [row(2, { [COL.key]: `${CARD}|bus`, [COL.boxes]: 3, [COL.amount]: 30000 })] }));
  assert.equal(same.shipping.length, 0);
  const changed = planImport(ctx(), book({ shipping: [row(2, { [COL.key]: `${CARD}|bus`, [COL.amount]: 25000 })] }));
  assert.equal(changed.shipping.length, 1);
  assert.equal(changed.shipping[0].isNew, true);
  assert.deepEqual(changed.shipping[0].input, { cardId: CARD, method: 'bus', boxes: 3, amount: 25000, sellerId: SELLER_A, paid: false, memo: null });
});

test('배송비: 키 없이 고객명+수단으로 새 줄을 만들고, 이미 있는 줄·없는 고객·금액 없음은 오류', () => {
  const ok = planImport(ctx(), book({ shipping: [row(2, { [COL.customer]: '가고객', [COL.method]: '퀵', [COL.amount]: 12000 })] }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.shipping[0].input, { cardId: CARD, method: 'quick', boxes: 3, amount: 12000, sellerId: SELLER_A, paid: false, memo: null });
  assert.equal(planImport(ctx(), book({ shipping: [row(2, { [COL.customer]: '가고객', [COL.method]: '버스', [COL.amount]: 1000 })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ shipping: [row(2, { [COL.customer]: '없는고객', [COL.method]: '퀵', [COL.amount]: 1000 })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ shipping: [row(2, { [COL.customer]: '가고객', [COL.method]: '퀵' })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ shipping: [row(2, { [COL.customer]: '가고객', [COL.method]: '운임', [COL.amount]: 1000 })] })).errors.length, 1);
});

test('배송비: 배송비 테이블이 없으면 그 시트만 오류', () => {
  const plan = planImport(ctx({ shipping: null }), book({ shipping: [row(2, { [COL.key]: `${CARD}|bus`, [COL.amount]: 1 })] }));
  assert.equal(plan.errors.length, 1);
  assert.equal(plan.errors[0].sheet, '배송비');
});

test('매입: 매입처는 이름으로 찾고 매입가·입금·메모를 바꾼다', () => {
  const plan = planImport(ctx(), book({ purchases: [row(2, { [COL.key]: `${DATE}|광어`, [COL.supplier]: '통영수산', [COL.purchase]: '12,000', [COL.paid]: 'Y', [COL.memo]: '현금' })] }));
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.purchases[0].fields, { supplierId: SUPPLIER, price: 12000, paid: true, memo: '현금' });
  const bad = planImport(ctx(), book({ purchases: [row(2, { [COL.key]: `${DATE}|광어`, [COL.supplier]: '모르는곳' })] }));
  assert.equal(bad.errors.length, 1);
});

test('오류가 하나라도 있으면 다른 시트의 정상 변경도 함께 보고하되 호출한 쪽이 적용하지 않는다', () => {
  const plan = planImport(ctx(), book({ sales: [row(2, { [COL.key]: 'item-1', [COL.price]: 5000 })], purchases: [row(2, { [COL.key]: 'nope' })] }));
  assert.equal(plan.sales.length, 1);
  assert.equal(plan.errors.length, 1);
});

test('시트가 파일에 없으면 건너뛴 시트로 알린다', () => {
  const plan = planImport(ctx(), book({ sales: [] }));
  assert.deepEqual(plan.skippedSheets, ['배송비', '매입']);
});

// ── 엑셀 파일 왕복(내보내기 → 읽기 → 계획) ───────────────────────────────────


const input = () => ({
  date: DATE,
  sales: [sale({ price: 4500, unitPrice: 1500, memo: '현금' }), sale({ itemId: 'item-2', product: '참돔', original: { product: '참돔', quantity: 3, unit: 'kg' }, sellerId: null })],
  shipping: [ship(), ship({ key: `${CARD}|quick`, method: 'quick', amount: 12000, saved: true, paid: true })],
  purchases: [purchase({ price: 8000, supplierId: SUPPLIER })],
  sellers: [{ id: SELLER_A, name: '열두달수산' }, { id: SELLER_B, name: '바른수산' }],
  suppliers: [{ id: SUPPLIER, name: '통영수산' }],
  shippingCustomers: ['가고객'],
});

async function roundTrip(edit?: (wb: ExcelJS.Workbook) => void): Promise<ParsedWorkbook> {
  const blob = await buildSettlementDayWorkbook(input());
  const buffer = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  if (edit) edit(wb);
  const out = await wb.xlsx.writeBuffer();
  return parseSettlementDayWorkbook(out as ArrayBuffer);
}

const colOf = (sheet: ExcelJS.Worksheet, header: string): number => {
  let found = 0;
  sheet.getRow(1).eachCell((c, i) => {
    if (c.value === header) found = i;
  });
  return found;
};

test('왕복: 내보낸 파일을 고치지 않고 가져오면 변경이 없다', async () => {
  const parsed = await roundTrip();
  assert.equal(parsed.date, DATE);
  const c = ctx({ sales: input().sales, shipping: { rows: input().shipping, cards: [card()] }, purchases: input().purchases });
  const plan = planImport(c, parsed);
  assert.deepEqual(plan.errors, []);
  assert.equal(planChangeCount(plan), 0);
});

test('왕복: 엑셀에서 고친 칸만 변경으로 읽힌다(판매가·입금·새 배송비 줄·매입가)', async () => {
  const parsed = await roundTrip((wb) => {
    const sales = wb.getWorksheet('판매')!;
    sales.getCell(2, colOf(sales, '판매가')).value = 6000;
    sales.getCell(3, colOf(sales, '입금')).value = 'Y';
    const shipping = wb.getWorksheet('배송비')!;
    const blank = 4; // 데이터 2행 뒤 첫 빈 줄
    shipping.getCell(blank, colOf(shipping, '고객명')).value = '가고객';
    shipping.getCell(blank, colOf(shipping, '수단')).value = '택배';
    shipping.getCell(blank, colOf(shipping, '배송비')).value = 3000;
    const purchases = wb.getWorksheet('매입')!;
    purchases.getCell(2, colOf(purchases, '매입가')).value = { formula: 'A1*0+9000', result: 9000 };
  });
  const c = ctx({ sales: input().sales, shipping: { rows: input().shipping, cards: [card()] }, purchases: input().purchases });
  const plan = planImport(c, parsed);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.sales.map((s) => s.fields), [{ price: 6000 }, { paid: true }]);
  assert.equal(plan.shipping.length, 1);
  assert.equal(plan.shipping[0].input.method, 'parcel');
  assert.equal(plan.shipping[0].input.amount, 3000);
  assert.deepEqual(plan.purchases.map((p) => p.fields), [{ price: 9000 }]);
});

test('왕복: 정보 시트가 없는 파일은 가져올 수 없다', async () => {
  const parsed = await roundTrip((wb) => wb.removeWorksheet(wb.getWorksheet('정보')!.id));
  assert.equal(parsed.date, null);
  assert.equal(planImport(ctx(), parsed).errors.length, 1);
});
