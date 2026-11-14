// 정산 엑셀 가져오기의 계획 만들기(순수 함수). 정산표와 같은 모양의 한 시트(고객 줄 · 상품 줄 · 배송비 줄)와 품목 단가표 시트를 읽은 값과
// 지금 DB 값을 견주어 "무엇이 어떻게 바뀌는지"(변경 목록)와 오류를 만든다. 화면 미리보기와 서버 적용이 같은 함수를 쓴다 — 적용은 항상 서버가 DB를 다시 읽어 이 계획을 새로 만든다.
// 규칙(결정: docs/decisions/2026-11-14-settlement-sheet.md): 빈 칸 = 변경 없음 / 삭제 없음 / 행은 숨김 키 열로 찾는다 / 오류가 하나라도 있으면 아무것도 적용하지 않는다.
// 칸을 고치는 규칙은 정산 화면과 같다(sheet.ts의 editLineCells·editShippingCells를 그대로 쓴다): 엑셀에는 "실제로 쓰는 값"(줄에서 고친 값 또는 단가표를 따르는 값)이 들어 있으므로,
// 지금 값과 같은 칸은 건드리지 않고 다른 칸만 줄에서 고친 값으로 저장한다.
import type { SalesRow } from './sales.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import type { SalesLineFields } from './sales-edit.ts';
import type { PriceEntry } from './pricing.ts';
import { MAX_SHIPPING_AMOUNT, SHIPPING_METHODS, parseShippingMethod, shippingKey, shippingLabel, type ShippingCard, type ShippingInput, type ShippingRow } from './shipping.ts';
import { buildGroups, editLineCells, editShippingCells, type SheetCol } from './sheet.ts';

// 시트 이름과 머리글(내보내기와 가져오기가 같이 쓴다). 가져올 때는 머리글 이름으로 열을 찾으므로 열 순서를 바꿔도 된다.
export const SHEET_MAIN = '정산표';
export const SHEET_PRICES = '단가표';
export const SHEET_INFO = '정보'; // 숨김: 정산일(B1). 다른 날짜 파일을 잘못 가져오는 것을 막는다
export const SHEET_LISTS = '목록'; // 숨김: 사업자구분·매입처·배송비 수단·고객명 선택 목록
export const COL = {
  key: '키',
  kind: '구분',
  customer: '고객명',
  product: '품목', // 배송비 줄은 수단(버스·퀵·택배)
  quantity: '수량', // 배송비 줄은 박스 수
  unit: '단위',
  unitPrice: '단가',
  price: '판매가', // 배송비 줄은 배송비
  supplier: '매입처',
  purchaseUnit: '매입단가',
  purchase: '매입가',
  profit: '수익',
  memo: '메모',
  seller: '사업자구분', // 고객 줄에만 있다
  paid: '입금', // 고객 줄에만 있다
  saleUnit: '판매 단가', // 단가표 시트
  defaultSupplier: '기본 매입처',
  buyUnit: '매입 단가',
} as const;
// 구분 열의 값: 고객 줄(사업자구분·입금), 상품 줄, 배송비 줄
export const KIND_CUSTOMER = '고객';
export const KIND_LINE = '상품';
export const KIND_SHIPPING = '배송비';
// 키 열의 접두사(행 종류를 알아보는 데 쓴다)
export const KEY_CARD = 'card:';
export const KEY_ITEM = 'item:';
export const KEY_SHIP = 'ship:';

export const MAIN_HEADERS: string[] = [COL.key, COL.kind, COL.customer, COL.product, COL.quantity, COL.unit, COL.unitPrice, COL.price, COL.supplier, COL.purchaseUnit, COL.purchase, COL.profit, COL.memo, COL.seller, COL.paid];
export const PRICE_HEADERS: string[] = [COL.key, COL.product, COL.saleUnit, COL.defaultSupplier, COL.buyUnit];

// 파일에서 읽은 값(화면이 exceljs로 읽어 단순한 값으로 바꿔서 서버에 보낸다)
export type Cell = string | number | null;
export interface RawRow {
  row: number; // 엑셀 행 번호(오류 안내용)
  cells: Record<string, Cell>; // 머리글 이름 → 값
}
export interface ParsedWorkbook {
  date: string | null; // 정보 시트의 정산일
  main: RawRow[] | null; // 시트가 없으면 null(그 시트는 건너뛴다)
  prices: RawRow[] | null;
}

// 지금 DB 값(서버가 날짜 하루치를 읽은 것)
export interface ImportContext {
  date: string;
  sales: SalesRow[]; // 실제로 쓰는 값(effective)과 줄에서 고친 값(own)이 모두 들어 있다
  shipping: { rows: ShippingRow[]; cards: ShippingCard[] } | null; // null = 배송비 테이블 없음(마이그레이션 전)
  sellers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  prices: Map<string, PriceEntry> | null; // 오늘의 단가표(품목 → 값). null = 단가표·줄 단위 매입 테이블 없음(0065 전)
  cardSettingsAvailable: boolean; // 고객 단위 사업자·입금 테이블(0064)이 있는지
}

export interface Diff {
  field: string;
  before: string;
  after: string;
}
export interface ImportIssue {
  sheet: string; // 시트 이름, 파일 전체 문제는 ''
  row: number | null;
  message: string;
}

// DB에 쓸 필드(보낸 것만 바꾼다)는 정산표의 저장과 같은 모양이다(sales-edit.ts의 SalesLineFields).
export type SalesFields = SalesLineFields;
export interface SalesChange {
  itemId: string;
  label: string;
  fields: SalesFields;
  diffs: Diff[];
}
export interface CardChange {
  cardId: string;
  label: string;
  sellerId?: string | null; // 보낸 항목만 바꾼다(null = 미지정)
  paid?: boolean;
  diffs: Diff[];
}
export interface ShippingChange {
  label: string;
  isNew: boolean; // 저장하지 않은 자동 산정 줄·새 줄을 이번에 처음 저장하는 것
  input: ShippingInput; // 바뀐 뒤의 전체 값
  diffs: Diff[];
}
export interface PriceChange {
  product: string;
  entry: PriceEntry; // 바뀐 뒤의 전체 값
  diffs: Diff[];
}
export interface ImportPlan {
  cards: CardChange[];
  sales: SalesChange[];
  shipping: ShippingChange[];
  prices: PriceChange[];
  errors: ImportIssue[];
  skippedSheets: string[]; // 파일에 없어서 건너뛴 시트
}

const MAX_SHEET_ROWS = 5000;

const isBlank = (c: Cell | undefined): boolean => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
const text = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim());
const won = (n: number | null): string => (n === null ? '(비어 있음)' : `${n.toLocaleString('ko-KR')}원`);
const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

// 숫자 칸: 숫자이거나 "1,000", "₩1,000", "1000원" 같은 글자. 아니면 null.
function parseNumber(c: Cell | undefined): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  const cleaned = c.replace(/[₩,\s]/g, '').replace(/원$/, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

type Issues = ImportIssue[];
const issue = (issues: Issues, sheet: string, row: number, message: string) => issues.push({ sheet, row, message });

// 같은 키가 두 번 나오면 어느 값이 맞는지 알 수 없다.
function duplicateKeys(issues: Issues, sheet: string, rows: RawRow[]): Set<string> {
  const seen = new Map<string, number>();
  const dup = new Set<string>();
  for (const r of rows) {
    const k = text(r.cells[COL.key]);
    if (k === '') continue;
    if (seen.has(k)) {
      dup.add(k);
      issue(issues, sheet, r.row, `같은 키의 행이 ${seen.get(k)}행에도 있습니다`);
    } else seen.set(k, r.row);
  }
  return dup;
}

// 고객 줄의 사업자구분 칸: "미지정"은 null, 사업자 관리에 있는 이름은 id, 모르는 이름은 undefined.
function resolveSeller(t: string, sellers: ImportContext['sellers']): string | null | undefined {
  if (t === '미지정') return null;
  return sellers.find((s) => s.name === t)?.id;
}
const sellerLabel = (id: string | null, sellers: ImportContext['sellers']) => (id === null ? '미지정' : (sellers.find((s) => s.id === id)?.name ?? '(알 수 없음)'));
const supplierLabel = (id: string | null, suppliers: ImportContext['suppliers']) => (id === null ? '(비어 있음)' : (suppliers.find((s) => s.id === id)?.name ?? '(알 수 없음)'));

// ── 정산표 시트 ────────────────────────────────────────────────────────────

// 상품 줄의 칸: 머리글 → 정산 화면의 열
const LINE_CELLS: { col: SheetCol; header: string; label: string; numeric: boolean }[] = [
  { col: 'product', header: COL.product, label: '품목', numeric: false },
  { col: 'quantity', header: COL.quantity, label: '수량', numeric: true },
  { col: 'unit', header: COL.unit, label: '단위', numeric: false },
  { col: 'unitPrice', header: COL.unitPrice, label: '단가', numeric: true },
  { col: 'price', header: COL.price, label: '판매가', numeric: true },
  { col: 'supplier', header: COL.supplier, label: '매입처', numeric: false },
  { col: 'purchaseUnit', header: COL.purchaseUnit, label: '매입단가', numeric: true },
  { col: 'purchase', header: COL.purchase, label: '매입가', numeric: true },
  { col: 'memo', header: COL.memo, label: '메모', numeric: false },
];

// 줄의 "지금 값"(실제로 쓰는 값). 엑셀에는 이 값이 들어 있다.
function currentLineValue(row: SalesRow, col: SheetCol, suppliers: ImportContext['suppliers']): number | string | null {
  switch (col) {
    case 'product': return row.product;
    case 'quantity': return row.quantity;
    case 'unit': return row.unit;
    case 'unitPrice': return row.unitPrice;
    case 'price': return row.price;
    case 'supplier': return row.supplierId === null ? '' : (suppliers.find((s) => s.id === row.supplierId)?.name ?? '');
    case 'purchaseUnit': return row.purchaseUnitPrice;
    case 'purchase': return row.purchasePrice;
    default: return row.memo;
  }
}

function planMain(ctx: ImportContext, rows: RawRow[], issues: Issues): { cards: CardChange[]; sales: SalesChange[]; shipping: ShippingChange[] } {
  const out = { cards: [] as CardChange[], sales: [] as SalesChange[], shipping: [] as ShippingChange[] };
  const sheet = SHEET_MAIN;
  const shippingRows = ctx.shipping?.rows ?? [];
  const groupByCard = new Map(buildGroups(ctx.sales, shippingRows).map((g) => [g.cardId, g]));
  const lineById = new Map(ctx.sales.map((s) => [s.itemId, s]));
  const shipByKey = new Map(shippingRows.map((s) => [s.key, s]));
  const dup = duplicateKeys(issues, sheet, rows);
  const newShipKeys = new Set<string>();

  for (const r of rows) {
    const key = text(r.cells[COL.key]);
    if (key !== '' && dup.has(key)) continue;
    const before = issues.length;

    // ── 고객 줄: 사업자구분·입금(고객 카드 단위) ──
    if (key.startsWith(KEY_CARD)) {
      const g = groupByCard.get(key.slice(KEY_CARD.length));
      if (!g) {
        issue(issues, sheet, r.row, '이 날짜의 고객이 아닙니다(내보낸 뒤 주문이 바뀌었거나 다른 파일입니다)');
        continue;
      }
      const change: CardChange = { cardId: g.cardId, label: g.customer, diffs: [] };
      const sellerCell = r.cells[COL.seller];
      if (!isBlank(sellerCell)) {
        const id = resolveSeller(text(sellerCell), ctx.sellers);
        if (id === undefined) issue(issues, sheet, r.row, `'사업자구분'이 사업자 관리에 없습니다: ${text(sellerCell)}`);
        else if (id !== g.sellerId) {
          change.sellerId = id;
          change.diffs.push({ field: '사업자구분', before: sellerLabel(g.sellerId, ctx.sellers), after: sellerLabel(id, ctx.sellers) });
        }
      }
      const paidCell = r.cells[COL.paid];
      if (!isBlank(paidCell)) {
        const t = text(paidCell).toUpperCase();
        if (t !== 'Y' && t !== 'N') issue(issues, sheet, r.row, `'입금' 값이 올바르지 않습니다: ${text(paidCell)} (Y 또는 N)`);
        else if ((t === 'Y') !== g.paid) {
          change.paid = t === 'Y';
          change.diffs.push({ field: '입금', before: g.paid ? 'Y' : 'N', after: t });
        }
      }
      if (issues.length === before && change.diffs.length > 0) {
        if (!ctx.cardSettingsAvailable) issue(issues, sheet, r.row, '고객 단위 사업자구분·입금 테이블이 아직 없습니다(마이그레이션 0064 적용 필요)');
        else out.cards.push(change);
      }
      continue;
    }

    // ── 상품 줄 ──
    if (key.startsWith(KEY_ITEM)) {
      const row = lineById.get(key.slice(KEY_ITEM.length));
      if (!row) {
        issue(issues, sheet, r.row, '이 날짜의 판매내역에 없는 행입니다(내보낸 뒤 주문이 바뀌었거나 다른 파일입니다)');
        continue;
      }
      // 지금 값과 다른 칸만 모은다(빈 칸·같은 값은 건너뛴다). 단가표를 따르는 값이 들어 있는 칸을 그대로 두면 그대로 단가표를 따른다.
      const cells: [SheetCol, string][] = [];
      const diffs: Diff[] = [];
      for (const c of LINE_CELLS) {
        const raw = r.cells[c.header];
        if (isBlank(raw)) continue;
        const current = currentLineValue(row, c.col, ctx.suppliers);
        if (c.numeric) {
          const n = parseNumber(raw);
          if (n !== null && same(n, current as number | null)) continue;
          cells.push([c.col, n === null ? text(raw) : String(n)]); // 숫자가 아닌 글자는 그대로 넘겨 편집 규칙이 오류를 만든다
          diffs.push({ field: c.label, before: current === null ? '(비어 있음)' : String(current), after: text(raw) });
        } else {
          if (text(raw) === String(current ?? '')) continue;
          cells.push([c.col, text(raw)]);
          diffs.push({ field: c.label, before: String(current ?? '') === '' ? '(비어 있음)' : String(current), after: text(raw) });
        }
      }
      if (cells.length === 0) continue;
      const edit = editLineCells(row, cells, ctx.suppliers);
      if (edit !== null && 'error' in edit) {
        issue(issues, sheet, r.row, edit.error);
        continue;
      }
      if (edit !== null) out.sales.push({ itemId: row.itemId, label: `${row.customer} · ${row.product}`, fields: edit.fields, diffs });
      continue;
    }

    // ── 배송비 줄(기존) ──
    if (key.startsWith(KEY_SHIP)) {
      const base = shipByKey.get(key.slice(KEY_SHIP.length));
      if (!base) {
        issue(issues, sheet, r.row, '이 날짜의 배송비 줄에 없는 행입니다(내보낸 뒤 주문이 바뀌었거나 다른 파일입니다)');
        continue;
      }
      const change = shippingChange(base, r, issues, sheet, false);
      if (change) out.shipping.push(change);
      continue;
    }

    // ── 키가 없는 줄: 새 배송비 줄(구분 = 배송비, 고객명·수단·배송비) ──
    if (key === '') {
      if (text(r.cells[COL.kind]) !== KIND_SHIPPING) {
        issue(issues, sheet, r.row, `키가 비어 있습니다. 새 줄은 구분을 '${KIND_SHIPPING}'로 적은 배송비 줄만 만들 수 있습니다(키 열을 지우지 마세요)`);
        continue;
      }
      if (!ctx.shipping) {
        issue(issues, sheet, r.row, '배송비 테이블이 아직 없습니다(마이그레이션 0062·0063 적용 필요)');
        continue;
      }
      const customer = text(r.cells[COL.customer]);
      const method = parseShippingMethod(text(r.cells[COL.product]));
      if (customer === '' || method === null) {
        issue(issues, sheet, r.row, `새 배송비 줄은 '고객명'과 '품목'(수단: ${SHIPPING_METHODS.map((m) => m.label).join('·')})을 모두 적어야 합니다`);
        continue;
      }
      const matched = ctx.shipping.cards.filter((c) => c.customer === customer);
      if (matched.length !== 1) {
        issue(issues, sheet, r.row, matched.length === 0 ? `이 날짜에 출고가 끝난 고객이 아닙니다: ${customer}` : `같은 이름의 카드가 ${matched.length}개라 정할 수 없습니다: ${customer} (정산 화면의 '＋ 배송비'로 넣으세요)`);
        continue;
      }
      const card = matched[0];
      const k = shippingKey(card.cardId, method);
      if (shipByKey.has(k) || newShipKeys.has(k)) {
        issue(issues, sheet, r.row, `이미 있는 줄입니다: ${customer} · ${shippingLabel(method)} (그 줄의 값을 고치세요)`);
        continue;
      }
      newShipKeys.add(k);
      const base: ShippingRow = { key: k, cardId: card.cardId, orderDate: card.orderDate, customer: card.customer, terminal: card.terminal, method, boxes: card.boxes, rate: null, amount: null, saved: false, sellerId: card.sellerId, paid: card.paid ?? false, memo: '', quickBlocked: false };
      const change = shippingChange(base, r, issues, sheet, true);
      if (change) out.shipping.push(change);
      continue;
    }

    issue(issues, sheet, r.row, '키를 알아볼 수 없습니다(키 열을 고치지 마세요)');
  }
  return out;
}

// 배송비 줄 하나의 변경(수량 = 박스 수, 판매가 = 배송비, 메모). 화면과 같은 규칙(editShippingCells)을 쓴다.
// 자동 산정 줄은 값을 고쳤을 때만 저장하고(고치지 않으면 제안으로 남는다), 새 줄은 배송비 금액이 있어야 한다.
function shippingChange(base: ShippingRow, r: RawRow, issues: Issues, sheet: string, isNewLine: boolean): ShippingChange | null {
  const cells: [SheetCol, string][] = [];
  const diffs: Diff[] = [];
  const boxes = r.cells[COL.quantity];
  if (!isBlank(boxes)) {
    const n = parseNumber(boxes);
    if (n === null || !same(n, base.boxes)) {
      cells.push(['quantity', n === null ? text(boxes) : String(n)]);
      diffs.push({ field: '박스', before: String(base.boxes), after: text(boxes) });
    }
  }
  const amount = r.cells[COL.price];
  if (!isBlank(amount)) {
    const n = parseNumber(amount);
    if (n === null || isNewLine || !same(n, base.amount)) {
      cells.push(['price', n === null ? text(amount) : String(n)]);
      diffs.push({ field: '배송비', before: won(base.amount), after: n === null ? text(amount) : won(n) });
    }
  }
  const memo = r.cells[COL.memo];
  if (!isBlank(memo) && text(memo) !== base.memo) {
    cells.push(['memo', text(memo)]);
    diffs.push({ field: '메모', before: base.memo || '(비어 있음)', after: text(memo) });
  }
  if (isNewLine && isBlank(amount)) {
    issue(issues, sheet, r.row, `새 배송비 줄은 '판매가'(배송비 금액)를 적어야 합니다: ${base.customer} · ${shippingLabel(base.method)}`);
    return null;
  }
  if (cells.length === 0) return null;
  const edit = editShippingCells(base, cells);
  if (edit === null) return null;
  if ('error' in edit) {
    issue(issues, sheet, r.row, edit.error);
    return null;
  }
  const next = edit.next;
  return {
    label: `${base.customer} · ${shippingLabel(base.method)}`,
    isNew: !base.saved,
    input: { cardId: next.cardId, method: next.method, boxes: next.boxes, amount: next.amount ?? 0, sellerId: next.sellerId, paid: next.paid, memo: next.memo || null },
    diffs,
  };
}

// ── 단가표 시트 ────────────────────────────────────────────────────────────

function planPrices(ctx: ImportContext, rows: RawRow[], issues: Issues): PriceChange[] {
  const sheet = SHEET_PRICES;
  if (!ctx.prices) {
    issue(issues, sheet, 0, '품목 단가표 테이블이 아직 없습니다(마이그레이션 0065 적용 필요)');
    return [];
  }
  const products = new Set(ctx.sales.map((s) => s.product));
  const dup = duplicateKeys(issues, sheet, rows);
  const changes: PriceChange[] = [];
  for (const r of rows) {
    const product = text(r.cells[COL.key]);
    if (product === '') {
      issue(issues, sheet, r.row, '키(품목)가 비어 있습니다. 단가표 행은 추가할 수 없습니다(키 열을 지우지 마세요)');
      continue;
    }
    if (dup.has(product)) continue;
    if (!products.has(product)) {
      issue(issues, sheet, r.row, `오늘 정산표에 없는 품목입니다: ${product} (내보낸 뒤 주문이 바뀌었거나 다른 파일입니다)`);
      continue;
    }
    const current: PriceEntry = ctx.prices.get(product) ?? { saleUnitPrice: null, supplierId: null, purchaseUnitPrice: null };
    const next = { ...current };
    const diffs: Diff[] = [];
    const before = issues.length;
    for (const [header, label, field] of [[COL.saleUnit, '판매 단가', 'saleUnitPrice'], [COL.buyUnit, '매입 단가', 'purchaseUnitPrice']] as const) {
      const raw = r.cells[header];
      if (isBlank(raw)) continue;
      const n = parseNumber(raw);
      if (n === null || !Number.isInteger(n) || n < 0 || n > MAX_SHIPPING_AMOUNT) {
        issue(issues, sheet, r.row, `'${header}' 값이 올바르지 않습니다: ${text(raw)} (0 이상의 정수로 입력하세요)`);
        continue;
      }
      if (n !== current[field]) {
        next[field] = n;
        diffs.push({ field: label, before: won(current[field]), after: won(n) });
      }
    }
    const supplierCell = r.cells[COL.defaultSupplier];
    if (!isBlank(supplierCell)) {
      const supplier = ctx.suppliers.find((s) => s.name === text(supplierCell));
      if (!supplier) issue(issues, sheet, r.row, `'기본 매입처'가 상품 관리에 없습니다: ${text(supplierCell)}`);
      else if (supplier.id !== current.supplierId) {
        next.supplierId = supplier.id;
        diffs.push({ field: '기본 매입처', before: supplierLabel(current.supplierId, ctx.suppliers), after: supplier.name });
      }
    }
    if (issues.length === before && diffs.length > 0) changes.push({ product, entry: next, diffs });
  }
  return changes;
}

export function planImport(ctx: ImportContext, workbook: ParsedWorkbook): ImportPlan {
  const issues: Issues = [];
  const plan: ImportPlan = { cards: [], sales: [], shipping: [], prices: [], errors: issues, skippedSheets: [] };
  if (workbook.date === null) {
    issue(issues, '', 0, "이 화면에서 내보낸 파일이 아닙니다('정보' 시트의 정산일을 찾지 못했습니다)");
    return plan;
  }
  if (workbook.date !== ctx.date) {
    issue(issues, '', 0, `다른 날짜의 파일입니다: 파일은 ${workbook.date}, 지금 화면은 ${ctx.date}입니다. 해당 날짜 화면에서 가져오세요`);
    return plan;
  }
  for (const [name, rows] of [[SHEET_MAIN, workbook.main], [SHEET_PRICES, workbook.prices]] as const) {
    if (rows !== null && rows.length > MAX_SHEET_ROWS) {
      issue(issues, name, 0, `행이 너무 많습니다(${rows.length}행, 최대 ${MAX_SHEET_ROWS.toLocaleString('ko-KR')}행)`);
      return plan;
    }
  }
  if (workbook.main === null) plan.skippedSheets.push(SHEET_MAIN);
  else Object.assign(plan, planMain(ctx, workbook.main, issues));
  if (workbook.prices === null) plan.skippedSheets.push(SHEET_PRICES);
  else plan.prices = planPrices(ctx, workbook.prices, issues);
  return plan;
}

export const planChangeCount = (plan: ImportPlan): number => plan.cards.length + plan.sales.length + plan.shipping.length + plan.prices.length;
