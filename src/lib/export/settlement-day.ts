// 정산 하루치 엑셀(판매 / 배송비 시트)을 만들고 읽는다(매입은 2단계에서 상품 줄 단위가 되어 3단계에서 정산표 형식으로 다시 넣는다)(브라우저 전용 — exceljs는 크므로 필요할 때만 불러온다).
// 내보낸 파일의 노란 칸을 고쳐서 다시 가져오면 일괄 수정된다. 변경 규칙과 검증은 src/lib/settlement/excel-import.ts가 한다.
import type { CellValue, Worksheet } from 'exceljs';
import type { SalesRow } from '../settlement/sales.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { SHIPPING_METHODS, shippingLabel, type ShippingRow } from '../settlement/shipping.ts';
import { COL, SALES_HEADERS, SHEET_INFO, SHEET_LISTS, SHEET_SALES, SHEET_SHIPPING, SHIPPING_HEADERS, type Cell, type ParsedWorkbook, type RawRow } from '../settlement/excel-import.ts';

export interface DayWorkbookInput {
  date: string;
  sales: SalesRow[];
  shipping: ShippingRow[] | null; // null = 배송비 테이블 없음(마이그레이션 전)
  shippingCustomers: string[]; // 새 배송비 줄을 넣을 수 있는(출고 완료) 고객명
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BLANK_SHIPPING_ROWS = 10; // 배송비 시트 맨 아래에 새 줄을 적을 빈 노란 칸 수

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
  // 선택 목록(숨김 시트): A 배송비 수단 / B 새 배송비 줄을 넣을 고객명
  const lists = workbook.addWorksheet(SHEET_LISTS, { state: 'hidden' });
  const methods = SHIPPING_METHODS.map((m) => m.label);
  const customers = [...new Set(input.shippingCustomers)].sort((a, b) => a.localeCompare(b, 'ko'));
  const columns = [methods, customers];
  ['수단', '고객명'].forEach((h, c) => {
    lists.getCell(1, c + 1).value = h;
    columns[c].forEach((v, r) => (lists.getCell(r + 2, c + 1).value = v));
  });

  // 판매
  const sales = workbook.addWorksheet(SHEET_SALES);
  fillSheet(
    sales,
    [
      { header: COL.key, width: 12, hidden: true },
      { header: COL.customer, width: 22 },
      { header: COL.product, width: 18, edit: true },
      { header: COL.quantity, width: 9, edit: true, numFmt: '#,##0.##' },
      { header: COL.unit, width: 8, edit: true },
      { header: COL.unitPrice, width: 12, edit: true, numFmt: WON },
      { header: COL.price, width: 14, edit: true, numFmt: WON },
      { header: COL.memo, width: 26, edit: true },
    ],
    input.sales.map((r) => [r.itemId, r.customer, r.product, r.quantity, r.unit, r.unitPrice, r.price, r.memo || null]),
  );

  // 배송비
  if (input.shipping) {
    const sheet = workbook.addWorksheet(SHEET_SHIPPING);
    const rows = input.shipping;
    fillSheet(
      sheet,
      [
        { header: COL.key, width: 12, hidden: true },
        { header: COL.customer, width: 22 },
        { header: COL.terminal, width: 12 },
        { header: COL.method, width: 8 },
        { header: COL.boxes, width: 8, edit: true, numFmt: '#,##0' },
        { header: COL.amount, width: 14, edit: true, numFmt: WON },
        { header: COL.memo, width: 26, edit: true },
        { header: COL.status, width: 8 },
      ],
      rows.map((r) => [r.key, r.customer, r.terminal, shippingLabel(r.method), r.boxes, r.amount, r.memo || null, r.saved ? '저장' : '자동']),
      BLANK_SHIPPING_ROWS,
    );
    const last = rows.length + 1 + BLANK_SHIPPING_ROWS;
    // 맨 아래 빈 줄: 새 줄은 고객명·수단·배송비를 적는다(그 칸은 노란색으로 열어 둔다)
    for (let r = rows.length + 2; r <= last; r++) {
      for (const c of [2, 4]) sheet.getCell(r, c).fill = EDIT_FILL;
      sheet.getCell(r, 4).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('A', methods.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '버스·퀵·택배 중에서 고르세요.' };
      if (customers.length > 0) sheet.getCell(r, 2).dataValidation = { type: 'list', allowBlank: true, formulae: [listFormula('B', customers.length)], showErrorMessage: true, errorTitle: '목록에서 고르세요', error: '이 날짜에 출고가 끝난 고객만 고를 수 있습니다.' };
    }
  }

  // 안내(보이는 시트)
  const guide = workbook.addWorksheet('안내');
  guide.getColumn(1).width = 100;
  [
    `정산 ${input.date} — 이 파일을 고쳐서 정산 화면의 "엑셀 가져오기"로 다시 올리면 일괄 수정됩니다.`,
    '',
    '· 노란 칸만 고치세요. 회색 칸(고객명·터미널·총 판매가·수익 등)은 참고용이라 고쳐도 반영되지 않습니다.',
    '· 빈 칸은 "변경 없음"입니다. 값을 지우려면 정산 화면에서 지우세요.',
    '· 숨겨진 "키" 열을 지우거나 바꾸지 마세요(행을 찾는 데 씁니다). 행을 지워도 삭제되지 않습니다.',
    '· 판매는 행을 추가할 수 없습니다. 배송비는 맨 아래 빈 노란 줄에 고객명·수단·배송비를 적으면 새 줄이 만들어집니다.',
    '· 판매·배송비의 사업자구분과 입금은 고객 단위 값이라 이 파일에 없습니다. 정산 화면의 고객 줄에서 정하세요.',
    '· 매입(매입처·매입단가·매입가)과 품목 단가표는 정산 화면에서 입력합니다. 이 파일에는 아직 없습니다.',
    '· 배송비의 "자동" 줄은 터미널 설정으로 계산한 값입니다. 값을 고치면 그 값으로 저장됩니다.',
    '· 가져오기 전에 변경 목록을 미리 보여 드립니다. 오류가 하나라도 있으면 아무것도 저장하지 않습니다.',
    '· 다른 날짜 파일은 가져올 수 없습니다.',
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
    sales: readSheet(workbook.getWorksheet(SHEET_SALES), SALES_HEADERS),
    shipping: readSheet(workbook.getWorksheet(SHEET_SHIPPING), SHIPPING_HEADERS),
      };
}
