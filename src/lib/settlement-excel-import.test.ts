import test from 'node:test';
import assert from 'node:assert/strict';
import { COL, planChangeCount, planImport, type ImportContext, type ParsedWorkbook, type RawRow } from './settlement/excel-import.ts';
import type { SalesRow } from './settlement/sales.ts';
import type { ShippingCard, ShippingRow } from './settlement/shipping.ts';
import ExcelJS from 'exceljs';
import { buildSettlementDayWorkbook, parseSettlementDayWorkbook, type DayWorkbookInput } from './export/settlement-day.ts';

const DATE = '2026-11-14';
const CARD = '11111111-1111-4111-8111-111111111111';
const SELLER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELLER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUPPLIER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sale = (over: Partial<SalesRow> = {}): SalesRow => ({
  itemId: 'item-1', cardId: CARD, orderDate: DATE, customer: '가고객', product: '광어', quantity: 3, unit: 'kg',
  original: { product: '광어', quantity: 3, unit: 'kg' }, edited: false, terminal: '동서울', secondaryWeightKg: null, sellerId: SELLER_A,
  price: null, unitPrice: null, supplierId: null, purchaseUnitPrice: null, purchasePrice: null,
  unitPriceOwn: null, priceOwn: null, supplierOwn: null, purchaseUnitOwn: null, purchaseOwn: null, paid: false, memo: '', ...over,
});
const ship = (over: Partial<ShippingRow> = {}): ShippingRow => ({
  key: `${CARD}|bus`, cardId: CARD, orderDate: DATE, customer: '가고객', terminal: '동서울', method: 'bus', boxes: 3, rate: 10000, amount: 30000,
  saved: false, sellerId: SELLER_A, paid: false, memo: '', quickBlocked: false, ...over,
});
const card = (over: Partial<ShippingCard> = {}): ShippingCard => ({ cardId: CARD, orderDate: DATE, customer: '가고객', terminal: '동서울', quickAllowed: true, boxes: 3, rates: { bus: 10000, quick: null, parcel: null }, sellerId: SELLER_A, paid: false, ...over });

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  date: DATE,
  sales: [sale()],
  shipping: { rows: [ship()], cards: [card()] },
  sellers: [{ id: SELLER_A, name: '열두달수산' }, { id: SELLER_B, name: '바른수산' }],
  suppliers: [{ id: SUPPLIER, name: '통영수산' }],
  prices: new Map(),
  cardSettingsAvailable: true,
  ...over,
});
const row = (n: number, cells: RawRow['cells']): RawRow => ({ row: n, cells });
const book = (over: Partial<ParsedWorkbook> = {}): ParsedWorkbook => ({ date: DATE, main: null, prices: null, ...over });
const item = (cells: RawRow['cells'], id = 'item-1') => row(3, { [COL.key]: `item:${id}`, ...cells });

test('날짜가 없거나 다르면 아무것도 계획하지 않고 오류만 낸다', () => {
  assert.equal(planImport(ctx(), book({ date: null })).errors.length, 1);
  const other = planImport(ctx(), book({ date: '2026-11-13', main: [item({ [COL.price]: 5000 })] }));
  assert.equal(other.errors.length, 1);
  assert.equal(planChangeCount(other), 0);
});

test('상품 줄: 지금 값과 다른 칸만 변경으로 잡고, 빈 칸과 같은 값은 건너뛴다', () => {
  const plan = planImport(ctx(), book({ main: [item({ [COL.product]: '광어', [COL.quantity]: 3, [COL.unitPrice]: '1,500', [COL.price]: 4500, [COL.memo]: null })] }));
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.sales.length, 1);
  assert.deepEqual(plan.sales[0].fields, { unitPrice: 1500, price: 4500 });
  assert.deepEqual(plan.sales[0].diffs.map((d) => d.field), ['단가', '판매가']);
});

test('상품 줄: 단가표를 따르는 값이 들어 있는 칸을 그대로 두면 줄 값으로 저장하지 않는다', () => {
  const following = sale({ unitPrice: 28000, price: 84000, supplierId: SUPPLIER, purchaseUnitPrice: 20000, purchasePrice: 60000 });
  const plan = planImport(ctx({ sales: [following] }), book({ main: [item({ [COL.unitPrice]: 28000, [COL.price]: 84000, [COL.supplier]: '통영수산', [COL.purchaseUnit]: 20000, [COL.purchase]: 60000 })] }));
  assert.deepEqual(plan.errors, []);
  assert.equal(planChangeCount(plan), 0);
});

test('상품 줄: 단가표를 따르던 칸을 다른 값으로 고치면 그 줄의 값으로 저장하고, 매입처는 이름으로 찾는다', () => {
  const following = sale({ unitPrice: 28000, price: 84000, purchaseUnitPrice: 20000, purchasePrice: 60000 });
  const plan = planImport(ctx({ sales: [following] }), book({ main: [item({ [COL.unitPrice]: 30000, [COL.supplier]: '통영수산', [COL.purchase]: 55000 })] }));
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.sales[0].fields, { unitPrice: 30000, supplierId: SUPPLIER, purchasePrice: 55000 });
});

test('상품 줄: 수량을 고치면 자동 계산으로 저장돼 있던 총액을 새 수량으로 다시 계산한다(화면과 같은 규칙)', () => {
  const stored = sale({ unitPrice: 28000, unitPriceOwn: 28000, price: 84000, priceOwn: 84000 });
  const plan = planImport(ctx({ sales: [stored] }), book({ main: [item({ [COL.quantity]: 1.1, [COL.price]: 84000 })] }));
  assert.deepEqual(plan.sales[0].fields, { quantity: 1.1, price: 30800 });
});

test('상품 줄: 숫자 형식·범위·모르는 매입처·모르는 키·중복 키·키 없는 줄은 오류로 모은다', () => {
  const plan = planImport(
    ctx(),
    book({
      main: [
        row(2, { [COL.key]: 'item:item-1', [COL.price]: 'abc' }),
        row(3, { [COL.key]: 'item:item-1', [COL.price]: 100 }),
        row(4, { [COL.key]: 'item:nope', [COL.price]: 100 }),
        row(5, { [COL.key]: '', [COL.kind]: '상품', [COL.price]: 100 }),
        row(6, { [COL.key]: 'weird', [COL.price]: 100 }),
        row(7, { [COL.key]: 'item:item-2', [COL.supplier]: '모르는곳' }),
      ],
    }),
  );
  assert.equal(planChangeCount(plan), 0);
  assert.ok(plan.errors.length >= 5);
});

test('고객 줄: 사업자구분은 이름으로 찾고(미지정은 null), 입금은 Y/N', () => {
  const key = `card:${CARD}`;
  const plan = planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.seller]: '바른수산', [COL.paid]: 'y' })] }));
  assert.deepEqual(plan.errors, []);
  assert.deepEqual([plan.cards[0].sellerId, plan.cards[0].paid], [SELLER_B, true]);
  const unset = planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.seller]: '미지정' })] }));
  assert.equal(unset.cards[0].sellerId, null);
  assert.equal(planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.seller]: '없는수산' })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.paid]: '예' })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.seller]: '열두달수산', [COL.paid]: 'N' })] })).cards.length, 0); // 같은 값
});

test('고객 줄: 고객 단위 테이블(0064)이 없으면 오류', () => {
  const plan = planImport(ctx({ cardSettingsAvailable: false }), book({ main: [row(2, { [COL.key]: `card:${CARD}`, [COL.paid]: 'Y' })] }));
  assert.equal(plan.errors.length, 1);
});

test('배송비 줄: 자동 산정 줄은 고치지 않으면 건너뛰고, 고치면 처음 저장한다', () => {
  const key = `ship:${CARD}|bus`;
  assert.equal(planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.quantity]: 3, [COL.price]: 30000 })] })).shipping.length, 0);
  const changed = planImport(ctx(), book({ main: [row(2, { [COL.key]: key, [COL.price]: 25000 })] }));
  assert.equal(changed.shipping.length, 1);
  assert.equal(changed.shipping[0].isNew, true);
  assert.deepEqual(changed.shipping[0].input, { cardId: CARD, method: 'bus', boxes: 3, amount: 25000, sellerId: SELLER_A, paid: false, memo: null });
});

test('배송비 줄: 키 없이 구분=배송비·고객명·수단으로 새 줄을 만들고, 이미 있는 줄·없는 고객·금액 없음·구분 없음은 오류', () => {
  const nu = (cells: RawRow['cells']) => row(2, { [COL.kind]: '배송비', ...cells });
  const ok = planImport(ctx(), book({ main: [nu({ [COL.customer]: '가고객', [COL.product]: '퀵', [COL.price]: 12000 })] }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.shipping[0].input, { cardId: CARD, method: 'quick', boxes: 3, amount: 12000, sellerId: SELLER_A, paid: false, memo: null });
  assert.equal(planImport(ctx(), book({ main: [nu({ [COL.customer]: '가고객', [COL.product]: '버스', [COL.price]: 1000 })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ main: [nu({ [COL.customer]: '없는고객', [COL.product]: '퀵', [COL.price]: 1000 })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ main: [nu({ [COL.customer]: '가고객', [COL.product]: '퀵' })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ main: [nu({ [COL.customer]: '가고객', [COL.product]: '운임', [COL.price]: 1000 })] })).errors.length, 1);
  assert.equal(planImport(ctx(), book({ main: [row(2, { [COL.customer]: '가고객', [COL.product]: '퀵', [COL.price]: 1000 })] })).errors.length, 1);
});

test('배송비 줄: 배송비 테이블이 없으면 새 줄은 오류', () => {
  const plan = planImport(ctx({ shipping: null }), book({ main: [row(2, { [COL.kind]: '배송비', [COL.customer]: '가고객', [COL.product]: '퀵', [COL.price]: 1000 })] }));
  assert.equal(plan.errors.length, 1);
});

test('단가표: 바뀐 칸만 변경으로 잡고 매입처는 이름으로 찾는다', () => {
  const prices = new Map([['광어', { saleUnitPrice: 28000, supplierId: null, purchaseUnitPrice: null }]]);
  const plan = planImport(ctx({ prices }), book({ prices: [row(2, { [COL.key]: '광어', [COL.saleUnit]: 28000, [COL.defaultSupplier]: '통영수산', [COL.buyUnit]: '20,000' })] }));
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.prices.map((p) => [p.product, p.entry]), [['광어', { saleUnitPrice: 28000, supplierId: SUPPLIER, purchaseUnitPrice: 20000 }]]);
  assert.deepEqual(plan.prices[0].diffs.map((d) => d.field), ['매입 단가', '기본 매입처']);
});

test('단가표: 오늘 없는 품목·모르는 매입처·잘못된 숫자·테이블 없음은 오류', () => {
  const two = ctx({ sales: [sale(), sale({ itemId: 'item-2', product: '참돔' })], prices: new Map() });
  const bad = planImport(two, book({ prices: [row(2, { [COL.key]: '없는품목', [COL.saleUnit]: 1 }), row(3, { [COL.key]: '광어', [COL.defaultSupplier]: '모르는곳' }), row(4, { [COL.key]: '참돔', [COL.saleUnit]: 'x' })] }));
  assert.equal(bad.errors.length, 3);
  assert.equal(planImport(ctx({ prices: null }), book({ prices: [row(2, { [COL.key]: '광어', [COL.saleUnit]: 1 })] })).errors.length, 1);
});

test('시트가 파일에 없으면 건너뛴 시트로 알린다', () => {
  assert.deepEqual(planImport(ctx(), book({ main: [] })).skippedSheets, ['단가표']);
  assert.deepEqual(planImport(ctx(), book()).skippedSheets, ['정산표', '단가표']);
});

// ── 엑셀 파일 왕복(내보내기 → 읽기 → 계획) ───────────────────────────────────

const input = (): DayWorkbookInput => ({
  date: DATE,
  sales: [
    sale({ unitPrice: 28000, price: 84000, supplierId: SUPPLIER, purchaseUnitPrice: 20000, purchasePrice: 60000, memo: '현금' }),
    sale({ itemId: 'item-2', product: '참돔', original: { product: '참돔', quantity: 3, unit: 'kg' }, sellerId: null, price: 4500, priceOwn: 4500 }),
  ],
  shipping: [ship(), ship({ key: `${CARD}|quick`, method: 'quick', amount: 12000, saved: true, paid: true })],
  sellers: [{ id: SELLER_A, name: '열두달수산' }, { id: SELLER_B, name: '바른수산' }],
  suppliers: [{ id: SUPPLIER, name: '통영수산' }],
  prices: [{ product: '광어', saleUnitPrice: 28000, supplierId: SUPPLIER, purchaseUnitPrice: 20000 }],
  shippingCustomers: ['가고객'],
  purchaseAvailable: true,
});
const roundCtx = (): ImportContext => ctx({ sales: input().sales, shipping: { rows: input().shipping!, cards: [card()] }, prices: new Map([['광어', { saleUnitPrice: 28000, supplierId: SUPPLIER, purchaseUnitPrice: 20000 }]]) });

async function roundTrip(edit?: (wb: ExcelJS.Workbook) => void): Promise<ParsedWorkbook> {
  const blob = await buildSettlementDayWorkbook(input());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  if (edit) edit(wb);
  return parseSettlementDayWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const colOf = (sheet: ExcelJS.Worksheet, header: string): number => {
  let found = 0;
  sheet.getRow(1).eachCell((c, i) => {
    if (c.value === header) found = i;
  });
  return found;
};
// 정산표의 행 번호: 1=머리글, 2=고객 줄, 3·4=상품 줄, 5·6=배송비 줄, 7~=빈 줄

test('왕복: 내보낸 파일을 고치지 않고 가져오면 변경이 없다', async () => {
  const parsed = await roundTrip();
  assert.equal(parsed.date, DATE);
  const plan = planImport(roundCtx(), parsed);
  assert.deepEqual(plan.errors, []);
  assert.equal(planChangeCount(plan), 0);
});

test('왕복: 엑셀에서 고친 칸만 변경으로 읽힌다(수식·사업자구분·입금·새 배송비 줄·단가표)', async () => {
  const parsed = await roundTrip((wb) => {
    const main = wb.getWorksheet('정산표')!;
    main.getCell(4, colOf(main, '판매가')).value = { formula: 'A1*0+6000', result: 6000 }; // 참돔 4,500 → 6,000(수식은 계산된 값을 읽는다)
    main.getCell(3, colOf(main, '매입단가')).value = 21000; // 단가표를 따르던 매입단가를 이 줄만 고침
    main.getCell(2, colOf(main, '사업자구분')).value = '바른수산';
    main.getCell(2, colOf(main, '입금')).value = 'Y';
    main.getCell(7, colOf(main, '구분')).value = '배송비';
    main.getCell(7, colOf(main, '고객명')).value = '가고객';
    main.getCell(7, colOf(main, '품목')).value = '택배';
    main.getCell(7, colOf(main, '판매가')).value = 3000;
    const prices = wb.getWorksheet('단가표')!;
    prices.getCell(2, colOf(prices, '판매 단가')).value = 29000;
  });
  const plan = planImport(roundCtx(), parsed);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.sales.map((s) => s.fields), [{ purchaseUnitPrice: 21000 }, { price: 6000 }]);
  assert.deepEqual([plan.cards[0].sellerId, plan.cards[0].paid], [SELLER_B, true]);
  assert.equal(plan.shipping.length, 1);
  assert.deepEqual([plan.shipping[0].input.method, plan.shipping[0].input.amount], ['parcel', 3000]);
  assert.deepEqual(plan.prices.map((p) => [p.product, p.entry.saleUnitPrice]), [['광어', 29000]]);
});

test('왕복: 정보 시트가 없는 파일은 가져올 수 없다', async () => {
  const parsed = await roundTrip((wb) => wb.removeWorksheet(wb.getWorksheet('정보')!.id));
  assert.equal(parsed.date, null);
  assert.equal(planImport(ctx(), parsed).errors.length, 1);
});

test('왕복: 단가표·줄 단위 매입이 없으면(0065 전) 매입 열과 단가표 시트를 뺀다', async () => {
  const blob = await buildSettlementDayWorkbook({ ...input(), purchaseAvailable: false, prices: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  assert.equal(wb.getWorksheet('단가표'), undefined);
  const main = wb.getWorksheet('정산표')!;
  assert.equal(main.getCell(3, colOf(main, '매입처')).value, null);
});
