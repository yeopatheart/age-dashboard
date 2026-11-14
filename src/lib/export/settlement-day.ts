// 정산 하루치 엑셀을 만들고 읽는다(브라우저 전용 — exceljs는 크므로 필요할 때만 불러온다). 시트는 정산표(화면과 같은 모양: 고객 줄 · 상품 줄 · 배송비 줄)와 단가표 두 개다.
// 내보낸 파일의 노란 칸을 고쳐서 다시 가져오면 일괄 수정된다. 변경 규칙과 검증은 src/lib/settlement/excel-import.ts가 한다.
import type { CellValue, Worksheet } from 'exceljs';
import type { SalesRow } from '../settlement/sales.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import type { PriceEntry } from '../settlement/pricing.ts';
import { SHIPPING_METHODS, shippingLabel, type ShippingRow } from '../settlement/shipping.ts';
import { buildGroups } from '../settlement/sheet.ts';
import { COL, KEY_CARD, KEY_ITEM, KEY_SHIP, KIND_CUSTOMER, KIND_LINE, KIND_SHIPPING, MAIN_HEADERS, PRICE_HEADERS, SHEET_INFO, SHEET_LISTS, SHEET_MAIN, SHEET_PRICES, type Cell, type ParsedWorkbook, type RawRow } from '../settlement/excel-import.ts';

export interface DayWorkbookInput {
  date: string;
  sales: SalesRow[]; // 실제로 쓰는 값(단가표를 따르는 값 포함)
  shipping: ShippingRow[] | null; // null = 배송비 테이블 없음(마이그레이션 전)
  sellers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  prices: (PriceEntry & { product: string })[]; // 오늘의 단가표(저장된 값). null이던 품목도 정산표에 나온 품목이면 행이 만들어진다
  shippingCustomers: string[]; // 새 배송비 줄을 넣을 수 있는(출고 완료) 고객명
  purchaseAvailable: boolean; // 단가표·줄 단위 매입(0065)이 있는지(없으면 매입 열과 단가표 시트를 뺀다)
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BLANK_SHIPPING_ROWS = 10; // 정산표 맨 아래에 새 배송비 줄을 적을 빈 줄 수

const thin = { style: 'thin' as const, color: { argb: 'FFA6A6A6' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const EDIT_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF8D6' } }; // 고칠 수 있는 칸
const READ_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F1F1' } }; // 참고용(고쳐도 반영되지 않음)
const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF9DC3E6' } };

interface ColumnSpec {
  header: string;
  width: number;
  edit?: boolean; // 고칠 수 있는 칸(노란색)
  numFmt?: string;
  hidden?: boolean;
}

// 머리글 줄·열 너비·칸 색을 입히고 데이터 행을 넣는다. 반환: 첫 데이터 행 번호(2).
function fillSheet(sheet: Worksheet, specs: ColumnSpec[], rows: (Cell | boolean)[][], extraBlankRows = 0) {
  sheet.columns = specs.map((s) => ({ header: s.header, width: s.width, hidden: s.hidden }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const head = sheet.getRow(1);
  head.height = 20;
  head.eachCell((cell) => {
    cell.font = { bold: true, size: 11 };
    cell.fill = HEAD_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border;
  });
  const total = rows.length + extraBlankRows;
  for (let i = 0; i < total; i++) {
    const row = sheet.addRow(i < rows.length ? rows[i] : specs.map(() => null));
    specs.forEach((s, c) => {
      const cell = row.getCell(c + 1);
      cell.border = border;
      cell.alignment = { vertical: 'middle' };
      cell.fill = s.edit ? EDIT_FILL : READ_FILL;
      if (s.numFmt) cell.numFmt = s.numFmt;
    });
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: specs.length } };
}

const listFormula = (col: string, count: number) => `'${SHEET_LISTS}'!$${col}$2:$${col}$${Math.max(2, count + 1)}`;

const WON = '#,##0';

export async function buildSettlementDayWorkbook(input: DayWorkbookInput): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sellerLabel = (id: string | null) => (id === null ? '미지정' : (input.sellers.find((s) => s.id === id)?.name ?? '미지정'));
  const supplierLabel = (id: string | null) => (id === null ? null : (input.suppliers.find((s) => s.id === id)?.name ?? null));

  // 선택 목록(숨김 시트): A 사업자구분(미지정 포함) / B 매입처 / C 배송비 수단 / D 새 배송비 줄을 넣을 고객명 / E 구분
  const lists = workbook.addWorksheet(SHEET_LISTS, { state: 'hidden' });
  const sellerNames = ['미지정', ...input.sellers.map((s) => s.name)];
  const methods = SHIPPING_METHODS.map((m) => m.label);
  const customers = [...new Set(input.shippingCustomers)].sort((a, b) => a.localeCompare(b, 'ko'));
  const columns = [sellerNames, input.suppliers.map((s) => s.name), methods, customers, [KIND_SHIPPING]];
  ['사업자구분', '매입처', '수단', '고객명', '구분'].forEach((h, c) => {
    lists.getCell(1, c + 1).value = h;
    columns[c].forEach((v, r) => (lists.getCell(r + 2, c + 1).value = v));
  });

  // 정산표: 화면과 같은 순서(고객 줄 → 그 고객의 상품 줄 → 배송비 줄)
  const groups = buildGroups(input.sales, input.shipping ?? []);
  const rows: (Cell | boolean)[][] = [];
  const kinds: ('customer' | 'line' | 'ship')[] = [];
  const purchase = input.purchaseAvailable;
  for (const g of groups) {
    rows.push([`${KEY_CARD}${g.cardId}`, KIND_CUSTOMER, g.customer, null, null, null, null, null, null, null, null, null, null, sellerLabel(g.sellerId), g.paid ? 'Y' : 'N']);
    kinds.push('customer');
    for (const l of g.lines) {
      rows.push([`${KEY_ITEM}${l.itemId}`, KIND_LINE, g.customer, l.product, l.quantity, l.unit, l.unitPrice, l.price, purchase ? supplierLabel(l.supplierId) : null, purchase ? l.purchaseUnitPrice : null, purchase ? l.purchasePrice : null, purchase && l.price !== null && l.purchasePrice !== null ? l.price - l.purchasePrice : null, l.memo || null, null, null]);
      kinds.push('line');
    }
    for (const s of g.shipping) {
      rows.push([`${KEY_SHIP}${s.key}`, KIND_SHIPPING, g.customer, shippingLabel(s.method), s.boxes, '박스', null, s.amount, null, null, null, null, s.memo || null, null, null]);
      kinds.push('ship');
    }
  }
  const main = workbook.addWorksheet(SHEET_MAIN);
  const mainSpecs: ColumnSpec[] = [
    { header: COL.key, width: 14, hidden: true },
    { header: COL.kind, width: 8 },
    { header: COL.customer, width: 22 },
    { header: COL.product, width: 18 },
    { header: COL.quantity, width: 9, numFmt: '#,##0.##' },
    { header: COL.unit, width: 7 },
    { header: COL.unitPrice, width: 11, numFmt: WON },
    { header: COL.price, width: 13, numFmt: WON },
    { header: COL.supplier, width: 13 },
    { header: COL.purchaseUnit, width: 11, numFmt: WON },
    { header: COL.purchase, width: 13, numFmt: WON },
    { header: COL.profit, width: 12, numFmt: WON },
    { header: COL.memo, width: 24 },
    { header: COL.seller, width: 13 },
    { header: COL.paid, width: 7 },
  ];
  fillSheet(main, mainSpecs, rows, BLANK_SHIPPING_ROWS);
  // 줄 종류에 따라 고칠 수 있는 칸(노란색)이 다르다: 고객 줄 = 사업자구분·입금 / 상품 줄 = 품목~메모(수익 제외) / 배송비 줄 = 박스(수량)·배송비(판매가)·메모
  const col = (name: string) => MAIN_HEADERS.indexOf(name) + 1;
  const editable = { customer: [COL.seller, COL.paid], line: [COL.product, COL.quantity, COL.unit, COL.unitPrice, COL.price, ...(purchase ? [COL.supplier, COL.purchaseUnit, COL.purchase] : []), COL.memo], ship: [COL.quantity, COL.price, COL.memo] };
  kinds.forEach((kind, i) => {
    const r = i + 2;
    for (const name of editable[kind]) main.getCell(r, col(name)).fill = EDIT_FILL;
    if (kind === 'customer') {
      main.getRow(r).font = { bold: true };
      main.getCell(r, col(COL.seller)).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('A', sellerNames.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '사업자 관리에 있는 사업자구분만 가져올 수 있습니다.' };
      main.getCell(r, col(COL.paid)).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Y,N"'] };
    } else if (kind === 'line' && purchase) {
      main.getCell(r, col(COL.supplier)).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('B', input.suppliers.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '상품 관리에 있는 매입처만 가져올 수 있습니다.' };
    }
  });
  // 맨 아래 빈 줄: 새 배송비 줄(구분 = 배송비, 고객명, 품목 = 수단, 판매가 = 배송비 금액)
  for (let i = 0; i < BLANK_SHIPPING_ROWS; i++) {
    const r = kinds.length + 2 + i;
    for (const name of [COL.kind, COL.customer, COL.product, COL.quantity, COL.price, COL.memo]) main.getCell(r, col(name)).fill = EDIT_FILL;
    main.getCell(r, col(COL.kind)).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('E', 1)], showErrorMessage: true, errorTitle: '배송비만 추가할 수 있습니다', error: "새 줄은 구분을 '배송비'로만 적을 수 있습니다." };
    main.getCell(r, col(COL.product)).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('C', methods.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '버스·퀵·택배 중에서 고르세요.' };
    if (customers.length > 0) main.getCell(r, col(COL.customer)).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('D', customers.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '이 날짜에 출고가 끝난 고객만 고를 수 있습니다.' };
  }

  // 단가표(오늘 나온 품목마다 한 행)
  if (purchase) {
    const products = [...new Set(input.sales.map((l) => l.product))].sort((a, b) => a.localeCompare(b, 'ko'));
    const entryOf = new Map(input.prices.map((p) => [p.product, p]));
    const sheet = workbook.addWorksheet(SHEET_PRICES);
    fillSheet(
      sheet,
      [
        { header: COL.key, width: 14, hidden: true },
        { header: COL.product, width: 20 },
        { header: COL.saleUnit, width: 13, edit: true, numFmt: WON },
        { header: COL.defaultSupplier, width: 16, edit: true },
        { header: COL.buyUnit, width: 13, edit: true, numFmt: WON },
      ],
      products.map((p) => [p, p, entryOf.get(p)?.saleUnitPrice ?? null, supplierLabel(entryOf.get(p)?.supplierId ?? null), entryOf.get(p)?.purchaseUnitPrice ?? null]),
    );
    for (let r = 2; r <= products.length + 1; r++) {
      sheet.getCell(r, 4).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('B', input.suppliers.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '상품 관리에 있는 매입처만 가져올 수 있습니다.' };
    }
  }

  // 안내(보이는 시트)
  const guide = workbook.addWorksheet('안내');
  guide.getColumn(1).width = 110;
  [
    `정산 ${input.date} — 이 파일을 고쳐서 정산 화면의 "엑셀 가져오기"로 다시 올리면 일괄 수정됩니다.`,
    '',
    '· 정산표 시트는 화면과 같은 모양입니다: 고객 줄(굵은 글씨) 아래에 그 고객의 상품 줄과 배송비 줄이 있습니다.',
    '· 노란 칸만 고치세요. 회색 칸(고객명·구분·수익 등)은 참고용이라 고쳐도 반영되지 않습니다.',
    '· 칸에 들어 있는 값은 "실제로 쓰는 값"입니다(단가표를 따르는 칸 포함). 그대로 두면 그대로 단가표를 따르고, 다른 값으로 고친 칸만 그 줄의 값으로 저장됩니다.',
    '· 빈 칸은 "변경 없음"입니다. 값을 지우려면 정산 화면에서 지우세요. 엑셀에서 행을 지워도 삭제되지 않습니다.',
    '· 사업자구분과 입금(Y/N)은 고객 줄에서 고객 단위로 정합니다. 사업자구분 "미지정"은 고객사의 사업자구분 기본값을 따릅니다.',
    '· 배송비 줄은 수량 = 박스 수, 판매가 = 배송비 금액입니다. "자동" 줄은 터미널 설정으로 계산한 값이고, 고쳐야 그 값으로 저장됩니다.',
    '· 새 배송비 줄은 맨 아래 빈 노란 줄에 구분 = 배송비, 고객명, 품목 = 수단(버스·퀵·택배), 판매가 = 금액을 적습니다. 상품·고객 줄은 추가할 수 없습니다.',
    '· 단가표 시트에서 품목별 판매 단가·기본 매입처·매입 단가를 고칠 수 있습니다. 매입처 지급 체크는 정산 화면에서 합니다.',
    '· 숨겨진 "키" 열을 지우거나 바꾸지 마세요(행을 찾는 데 씁니다).',
    '· 가져오기 전에 변경 목록을 미리 보여 드립니다. 오류가 하나라도 있으면 아무것도 저장하지 않습니다. 다른 날짜 파일은 가져올 수 없습니다.',
  ].forEach((line, i) => {
    const cell = guide.getCell(i + 1, 1);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) cell.font = { bold: true, size: 12 };
  });

  // 정보(숨김): 어느 날짜 파일인지
  const info = workbook.addWorksheet(SHEET_INFO, { state: 'hidden' });
  info.getCell('A1').value = '정산일';
  info.getCell('B1').value = input.date;

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_TYPE });
}

// ── 읽기 ────────────────────────────────────────────────────────────────

function toCell(v: CellValue | undefined): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Y' : 'N';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return toCell(v.result as CellValue); // 수식은 계산된 값을 읽는다
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text; // 하이퍼링크
    if ('error' in v) return String(v.error);
  }
  return null;
}

function readSheet(sheet: Worksheet | undefined, headers: string[]): RawRow[] | null {
  if (!sheet) return null;
  const columnOf = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const name = String(toCell(cell.value) ?? '').trim();
    if (headers.includes(name)) columnOf.set(name, col);
  });
  const rows: RawRow[] = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    const cells: Record<string, Cell> = {};
    let any = false;
    for (const [name, col] of columnOf) {
      const value = toCell(row.getCell(col).value);
      cells[name] = value;
      if (value !== null && String(value).trim() !== '') any = true;
    }
    if (any) rows.push({ row: n, cells }); // 완전히 빈 줄은 건너뛴다
  }
  return rows;
}

export async function parseSettlementDayWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const dateValue = toCell(workbook.getWorksheet(SHEET_INFO)?.getCell('B1').value);
  const date = typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim()) ? dateValue.trim() : null;
  return {
    date,
    main: readSheet(workbook.getWorksheet(SHEET_MAIN), MAIN_HEADERS),
    prices: readSheet(workbook.getWorksheet(SHEET_PRICES), PRICE_HEADERS),
  };
}
