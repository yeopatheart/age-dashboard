// 정산 엑셀 가져오기의 계획 만들기(순수 함수). 하루치 통합 파일(판매 / 배송비 / 매입 3시트)을 읽은 값과 지금 DB 값을 견주어
// "무엇이 어떻게 바뀌는지"(변경 목록)와 오류를 만든다. 화면 미리보기와 서버 적용이 같은 함수를 쓴다 — 적용은 항상 서버가 DB를 다시 읽어 이 계획을 새로 만든다.
// 규칙(결정: docs/decisions/2026-11-14-settlement-shipping.md): 빈 칸 = 변경 없음 / 삭제 없음 / 행은 숨김 키 열로 찾는다 / 오류가 하나라도 있으면 아무것도 적용하지 않는다.
import type { SalesRow } from './sales.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import type { PurchaseRow } from './purchases.ts';
import { MAX_BOXES, MAX_SHIPPING_AMOUNT, SHIPPING_METHODS, parseShippingMethod, shippingKey, shippingLabel, type ShippingCard, type ShippingInput, type ShippingRow } from './shipping.ts';

// 시트 이름과 머리글(내보내기와 가져오기가 같이 쓴다). 가져올 때는 머리글 이름으로 열을 찾으므로 열 순서를 바꿔도 된다.
export const SHEET_SALES = '판매';
export const SHEET_SHIPPING = '배송비';
export const SHEET_PURCHASES = '매입';
export const SHEET_INFO = '정보'; // 숨김: 정산일(B1). 다른 날짜 파일을 잘못 가져오는 것을 막는다
export const SHEET_LISTS = '목록'; // 숨김: 사업자구분·매입처 선택 목록
export const COL = {
  key: '키',
  customer: '고객명',
  terminal: '터미널',
  product: '품목',
  quantity: '수량',
  unit: '단위',
  unitPrice: '단가',
  price: '판매가',
  seller: '사업자구분',
  paid: '입금',
  memo: '메모',
  method: '수단',
  boxes: '박스',
  amount: '배송비',
  status: '상태',
  supplier: '매입처',
  purchase: '매입가',
  salesTotal: '총 판매가',
  profit: '수익',
} as const;
export const SALES_HEADERS = [COL.key, COL.customer, COL.product, COL.quantity, COL.unit, COL.unitPrice, COL.price, COL.seller, COL.paid, COL.memo];
export const SHIPPING_HEADERS = [COL.key, COL.customer, COL.terminal, COL.method, COL.boxes, COL.amount, COL.seller, COL.paid, COL.memo, COL.status];
export const PURCHASE_HEADERS = [COL.key, COL.product, COL.supplier, COL.purchase, COL.seller, COL.paid, COL.memo, COL.salesTotal, COL.profit];

// 파일에서 읽은 값(화면이 exceljs로 읽어 단순한 값으로 바꿔서 서버에 보낸다)
export type Cell = string | number | null;
export interface RawRow {
  row: number; // 엑셀 행 번호(오류 안내용)
  cells: Record<string, Cell>; // 머리글 이름 → 값
}
export interface ParsedWorkbook {
  date: string | null; // 정보 시트의 정산일
  sales: RawRow[] | null; // 시트가 없으면 null(그 시트는 건너뛴다)
  shipping: RawRow[] | null;
  purchases: RawRow[] | null;
}

// 지금 DB 값(서버가 날짜 하루치를 읽은 것)
export interface ImportContext {
  date: string;
  sales: SalesRow[];
  shipping: { rows: ShippingRow[]; cards: ShippingCard[] } | null; // null = 배송비 테이블 없음(마이그레이션 전)
  purchases: PurchaseRow[] | null; // null = 매입 테이블 없음
  sellers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
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

// DB에 쓸 필드(보낸 것만 바꾼다). product·quantity·unit의 null은 "주문 목록 값으로 되돌림"이다.
export interface SalesFields {
  sellerId?: string | null;
  price?: number;
  unitPrice?: number;
  product?: string | null;
  quantity?: number | null;
  unit?: string | null;
  paid?: boolean;
  memo?: string;
}
export interface SalesChange {
  itemId: string;
  label: string;
  fields: SalesFields;
  diffs: Diff[];
}
export interface ShippingChange {
  label: string;
  isNew: boolean; // 저장하지 않은 제안 줄·새 줄을 이번에 처음 저장하는 것
  input: ShippingInput; // 바뀐 뒤의 전체 값
  diffs: Diff[];
}
export interface PurchaseFields {
  supplierId?: string | null;
  price?: number;
  sellerId?: string | null;
  paid?: boolean;
  memo?: string;
}
export interface PurchaseChange {
  orderDate: string;
  productName: string;
  label: string;
  fields: PurchaseFields;
  diffs: Diff[];
}
export interface ImportPlan {
  sales: SalesChange[];
  shipping: ShippingChange[];
  purchases: PurchaseChange[];
  errors: ImportIssue[];
  skippedSheets: string[]; // 파일에 없어서 건너뛴 시트
}

const MAX_PRICE = MAX_SHIPPING_AMOUNT; // 판매가·단가·매입가·배송비 모두 11자리까지
const MAX_QUANTITY = 100_000;
const NO_SELLER = '미지정';

const isBlank = (c: Cell | undefined): boolean => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
const text = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim());

// 숫자 칸: 숫자이거나 "1,000", "₩1,000", "1000원" 같은 글자. 아니면 null.
function parseNumber(c: Cell | undefined): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  const cleaned = c.replace(/[₩,\s]/g, '').replace(/원$/, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const won = (n: number | null): string => (n === null ? '(비어 있음)' : `${n.toLocaleString('ko-KR')}원`);
const yn = (b: boolean): string => (b ? 'Y' : 'N');

// 입금 칸: Y/N(대소문자 무관). 아니면 null.
function parsePaid(c: Cell | undefined): boolean | null {
  const t = text(c).toUpperCase();
  return t === 'Y' ? true : t === 'N' ? false : null;
}

type Issues = ImportIssue[];
const issue = (issues: Issues, sheet: string, row: number, message: string) => issues.push({ sheet, row, message });

// 사업자구분 칸: 이름 → id. "미지정"은 null(고객사 기본값으로 돌아간다). 모르는 이름은 undefined.
function resolveSeller(c: Cell | undefined, sellers: ImportContext['sellers']): string | null | undefined {
  const t = text(c);
  if (t === NO_SELLER) return null;
  return sellers.find((s) => s.name === t)?.id;
}
const sellerName = (id: string | null, sellers: ImportContext['sellers']): string => (id === null ? NO_SELLER : (sellers.find((s) => s.id === id)?.name ?? '(알 수 없음)'));

function integerField(issues: Issues, sheet: string, r: RawRow, col: string, max = MAX_PRICE): number | null | undefined {
  const c = r.cells[col];
  if (isBlank(c)) return undefined;
  const n = parseNumber(c);
  if (n === null || !Number.isInteger(n) || n < 0 || n > max) {
    issue(issues, sheet, r.row, `'${col}' 값이 올바르지 않습니다: ${text(c)} (0 이상의 정수로 입력하세요)`);
    return null;
  }
  return n;
}

function paidField(issues: Issues, sheet: string, r: RawRow): boolean | null | undefined {
  const c = r.cells[COL.paid];
  if (isBlank(c)) return undefined;
  const p = parsePaid(c);
  if (p === null) {
    issue(issues, sheet, r.row, `'입금' 값이 올바르지 않습니다: ${text(c)} (Y 또는 N)`);
    return null;
  }
  return p;
}

function memoField(issues: Issues, sheet: string, r: RawRow): string | undefined {
  const c = r.cells[COL.memo];
  if (isBlank(c)) return undefined;
  const t = text(c);
  if (t.length > 500) {
    issue(issues, sheet, r.row, `'메모'는 500자 이하로 입력하세요(${t.length}자)`);
    return undefined;
  }
  return t;
}

function sellerField(issues: Issues, sheet: string, r: RawRow, sellers: ImportContext['sellers']): string | null | undefined {
  const c = r.cells[COL.seller];
  if (isBlank(c)) return undefined;
  const id = resolveSeller(c, sellers);
  if (id === undefined) {
    issue(issues, sheet, r.row, `'사업자구분'이 사업자 관리에 없습니다: ${text(c)}`);
    return undefined;
  }
  return id;
}

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

// ── 판매 ─────────────────────────────────────────────────────────────────

function planSales(ctx: ImportContext, rows: RawRow[], issues: Issues): SalesChange[] {
  const byId = new Map(ctx.sales.map((s) => [s.itemId, s]));
  const dup = duplicateKeys(issues, SHEET_SALES, rows);
  const changes: SalesChange[] = [];
  for (const r of rows) {
    const key = text(r.cells[COL.key]);
    if (key === '') {
      issue(issues, SHEET_SALES, r.row, '키가 비어 있습니다. 판매 행은 추가할 수 없습니다(키 열을 지우지 마세요)');
      continue;
    }
    if (dup.has(key)) continue;
    const row = byId.get(key);
    if (!row) {
      issue(issues, SHEET_SALES, r.row, '이 날짜의 판매내역에 없는 행입니다(내보낸 뒤 주문이 바뀌었거나 다른 파일입니다)');
      continue;
    }
    const before = issues.length;
    const fields: SalesFields = {};
    const diffs: Diff[] = [];

    const productCell = r.cells[COL.product];
    if (!isBlank(productCell)) {
      const p = text(productCell);
      if (p.length > 60) issue(issues, SHEET_SALES, r.row, `'품목'은 60자 이하로 입력하세요`);
      else if (p !== row.product) {
        fields.product = p === row.original.product ? null : p;
        diffs.push({ field: '품목', before: row.product, after: p });
      }
    }
    const quantityCell = r.cells[COL.quantity];
    if (!isBlank(quantityCell)) {
      const q = parseNumber(quantityCell);
      if (q === null || q <= 0 || q > MAX_QUANTITY || Math.round(q * 100) / 100 !== q) {
        issue(issues, SHEET_SALES, r.row, `'수량'이 올바르지 않습니다: ${text(quantityCell)} (0보다 크고 ${MAX_QUANTITY.toLocaleString('ko-KR')} 이하, 소수 둘째 자리까지)`);
      } else if (q !== row.quantity) {
        fields.quantity = q === row.original.quantity ? null : q;
        diffs.push({ field: '수량', before: String(row.quantity), after: String(q) });
      }
    }
    const unitCell = r.cells[COL.unit];
    if (!isBlank(unitCell)) {
      const u = text(unitCell);
      if (u.length > 10) issue(issues, SHEET_SALES, r.row, `'단위'는 10자 이하로 입력하세요`);
      else if (u !== row.unit) {
        fields.unit = u === row.original.unit ? null : u;
        diffs.push({ field: '단위', before: row.unit, after: u });
      }
    }
    const unitPrice = integerField(issues, SHEET_SALES, r, COL.unitPrice);
    if (typeof unitPrice === 'number' && unitPrice !== row.unitPrice) {
      fields.unitPrice = unitPrice;
      diffs.push({ field: '단가', before: won(row.unitPrice), after: won(unitPrice) });
    }
    const price = integerField(issues, SHEET_SALES, r, COL.price);
    if (typeof price === 'number' && price !== row.price) {
      fields.price = price;
      diffs.push({ field: '판매가', before: won(row.price), after: won(price) });
    }
    const seller = sellerField(issues, SHEET_SALES, r, ctx.sellers);
    if (seller !== undefined && seller !== row.sellerId) {
      fields.sellerId = seller;
      diffs.push({ field: '사업자구분', before: sellerName(row.sellerId, ctx.sellers), after: sellerName(seller, ctx.sellers) });
    }
    const paid = paidField(issues, SHEET_SALES, r);
    if (typeof paid === 'boolean' && paid !== row.paid) {
      fields.paid = paid;
      diffs.push({ field: '입금', before: yn(row.paid), after: yn(paid) });
    }
    const memo = memoField(issues, SHEET_SALES, r);
    if (memo !== undefined && memo !== row.memo) {
      fields.memo = memo;
      diffs.push({ field: '메모', before: row.memo || '(비어 있음)', after: memo });
    }
    if (issues.length === before && diffs.length > 0) changes.push({ itemId: row.itemId, label: `${row.customer} · ${row.product}`, fields, diffs });
  }
  return changes;
}

// ── 배송비 ───────────────────────────────────────────────────────────────

function planShipping(ctx: ImportContext, rows: RawRow[], issues: Issues): ShippingChange[] {
  if (!ctx.shipping) {
    issue(issues, SHEET_SHIPPING, 0, '배송비 테이블이 아직 없습니다(마이그레이션 0062 적용 필요)');
    return [];
  }
  const { rows: current, cards } = ctx.shipping;
  const byKey = new Map(current.map((s) => [s.key, s]));
  const dup = duplicateKeys(issues, SHEET_SHIPPING, rows);
  const changes: ShippingChange[] = [];
  const newKeys = new Set<string>();
  for (const r of rows) {
    const key = text(r.cells[COL.key]);
    if (key !== '' && dup.has(key)) continue;
    const before = issues.length;

    // 행 찾기: 키가 있으면 키로, 비어 있으면 (고객명, 수단)으로 새 줄을 만든다.
    let base: ShippingRow | undefined;
    let isNewLine = false;
    if (key !== '') {
      base = byKey.get(key);
      if (!base) {
        issue(issues, SHEET_SHIPPING, r.row, '이 날짜의 배송비 줄에 없는 행입니다(내보낸 뒤 주문이 바뀌었거나 다른 파일입니다)');
        continue;
      }
    } else {
      const customer = text(r.cells[COL.customer]);
      const method = parseShippingMethod(text(r.cells[COL.method]));
      if (customer === '' || method === null) {
        issue(issues, SHEET_SHIPPING, r.row, `새 줄은 '고객명'과 '수단'(${SHIPPING_METHODS.map((m) => m.label).join('·')})을 모두 적어야 합니다`);
        continue;
      }
      const matched = cards.filter((c) => c.customer === customer);
      if (matched.length !== 1) {
        issue(issues, SHEET_SHIPPING, r.row, matched.length === 0 ? `이 날짜에 출고가 끝난 고객이 아닙니다: ${customer}` : `같은 이름의 카드가 ${matched.length}개라 정할 수 없습니다: ${customer} (정산 화면의 '배송비 추가'로 넣으세요)`);
        continue;
      }
      const card = matched[0];
      const k = shippingKey(card.cardId, method);
      if (byKey.has(k) || newKeys.has(k)) {
        issue(issues, SHEET_SHIPPING, r.row, `이미 있는 줄입니다: ${customer} · ${shippingLabel(method)} (그 줄의 키를 그대로 두고 값을 고치세요)`);
        continue;
      }
      newKeys.add(k);
      isNewLine = true;
      base = { key: k, cardId: card.cardId, orderDate: card.orderDate, customer: card.customer, terminal: card.terminal, method, boxes: card.boxes, rate: null, amount: null, saved: false, sellerId: card.sellerId, paid: false, memo: '', quickBlocked: false };
    }

    const next: ShippingRow = { ...base };
    const diffs: Diff[] = [];
    const boxes = integerField(issues, SHEET_SHIPPING, r, COL.boxes, MAX_BOXES);
    if (typeof boxes === 'number' && boxes !== base.boxes) {
      next.boxes = boxes;
      diffs.push({ field: '박스', before: String(base.boxes), after: String(boxes) });
    }
    const amount = integerField(issues, SHEET_SHIPPING, r, COL.amount);
    if (typeof amount === 'number' && amount !== base.amount) {
      next.amount = amount;
      diffs.push({ field: '배송비', before: won(base.amount), after: won(amount) });
    }
    const seller = sellerField(issues, SHEET_SHIPPING, r, ctx.sellers);
    if (seller !== undefined && seller !== base.sellerId) {
      next.sellerId = seller;
      diffs.push({ field: '사업자구분', before: sellerName(base.sellerId, ctx.sellers), after: sellerName(seller, ctx.sellers) });
    }
    const paid = paidField(issues, SHEET_SHIPPING, r);
    if (typeof paid === 'boolean' && paid !== base.paid) {
      next.paid = paid;
      diffs.push({ field: '입금', before: yn(base.paid), after: yn(paid) });
    }
    const memo = memoField(issues, SHEET_SHIPPING, r);
    if (memo !== undefined && memo !== base.memo) {
      next.memo = memo;
      diffs.push({ field: '메모', before: base.memo || '(비어 있음)', after: memo });
    }
    if (isNewLine && next.amount === null) {
      issue(issues, SHEET_SHIPPING, r.row, `새 줄은 '배송비' 금액을 적어야 합니다: ${base.customer} · ${shippingLabel(base.method)}`);
      continue;
    }
    if (issues.length !== before || (diffs.length === 0 && !isNewLine)) continue;
    changes.push({
      label: `${base.customer} · ${shippingLabel(base.method)}`,
      isNew: !base.saved,
      input: { cardId: next.cardId, method: next.method, boxes: next.boxes, amount: next.amount ?? 0, sellerId: next.sellerId, paid: next.paid, memo: next.memo || null },
      diffs: diffs.length > 0 ? diffs : [{ field: '새 줄', before: '(없음)', after: won(next.amount) }],
    });
  }
  return changes;
}

// ── 매입 ─────────────────────────────────────────────────────────────────

function planPurchases(ctx: ImportContext, rows: RawRow[], issues: Issues): PurchaseChange[] {
  if (!ctx.purchases) {
    issue(issues, SHEET_PURCHASES, 0, '매입 테이블이 아직 없습니다(마이그레이션 0044 적용 필요)');
    return [];
  }
  const byKey = new Map(ctx.purchases.map((p) => [p.key, p]));
  const dup = duplicateKeys(issues, SHEET_PURCHASES, rows);
  const changes: PurchaseChange[] = [];
  for (const r of rows) {
    const key = text(r.cells[COL.key]);
    if (key === '') {
      issue(issues, SHEET_PURCHASES, r.row, '키가 비어 있습니다. 매입 행은 추가할 수 없습니다(키 열을 지우지 마세요)');
      continue;
    }
    if (dup.has(key)) continue;
    const row = byKey.get(key);
    if (!row) {
      issue(issues, SHEET_PURCHASES, r.row, '이 날짜의 매입내역에 없는 행입니다(내보낸 뒤 판매내역이 바뀌었거나 다른 파일입니다)');
      continue;
    }
    const before = issues.length;
    const fields: PurchaseFields = {};
    const diffs: Diff[] = [];
    const supplierCell = r.cells[COL.supplier];
    if (!isBlank(supplierCell)) {
      const name = text(supplierCell);
      const supplier = ctx.suppliers.find((s) => s.name === name);
      if (!supplier) issue(issues, SHEET_PURCHASES, r.row, `'매입처'가 상품 관리에 없습니다: ${name}`);
      else if (supplier.id !== row.supplierId) {
        fields.supplierId = supplier.id;
        diffs.push({ field: '매입처', before: ctx.suppliers.find((s) => s.id === row.supplierId)?.name ?? '(비어 있음)', after: supplier.name });
      }
    }
    const price = integerField(issues, SHEET_PURCHASES, r, COL.purchase);
    if (typeof price === 'number' && price !== row.price) {
      fields.price = price;
      diffs.push({ field: '매입가', before: won(row.price), after: won(price) });
    }
    const seller = sellerField(issues, SHEET_PURCHASES, r, ctx.sellers);
    if (seller !== undefined && seller !== row.sellerId) {
      fields.sellerId = seller;
      diffs.push({ field: '사업자구분', before: sellerName(row.sellerId, ctx.sellers), after: sellerName(seller, ctx.sellers) });
    }
    const paid = paidField(issues, SHEET_PURCHASES, r);
    if (typeof paid === 'boolean' && paid !== row.paid) {
      fields.paid = paid;
      diffs.push({ field: '입금', before: yn(row.paid), after: yn(paid) });
    }
    const memo = memoField(issues, SHEET_PURCHASES, r);
    if (memo !== undefined && memo !== row.memo) {
      fields.memo = memo;
      diffs.push({ field: '메모', before: row.memo || '(비어 있음)', after: memo });
    }
    if (issues.length === before && diffs.length > 0) changes.push({ orderDate: row.orderDate, productName: row.product, label: row.product, fields, diffs });
  }
  return changes;
}

const MAX_SHEET_ROWS = 5000;

export function planImport(ctx: ImportContext, workbook: ParsedWorkbook): ImportPlan {
  const issues: Issues = [];
  const plan: ImportPlan = { sales: [], shipping: [], purchases: [], errors: issues, skippedSheets: [] };
  if (workbook.date === null) {
    issue(issues, '', 0, "이 화면에서 내보낸 파일이 아닙니다('정보' 시트의 정산일을 찾지 못했습니다)");
    return plan;
  }
  if (workbook.date !== ctx.date) {
    issue(issues, '', 0, `다른 날짜의 파일입니다: 파일은 ${workbook.date}, 지금 화면은 ${ctx.date}입니다. 해당 날짜 화면에서 가져오세요`);
    return plan;
  }
  for (const [name, rows] of [[SHEET_SALES, workbook.sales], [SHEET_SHIPPING, workbook.shipping], [SHEET_PURCHASES, workbook.purchases]] as const) {
    if (rows !== null && rows.length > MAX_SHEET_ROWS) {
      issue(issues, name, 0, `행이 너무 많습니다(${rows.length}행, 최대 ${MAX_SHEET_ROWS.toLocaleString('ko-KR')}행)`);
      return plan;
    }
  }
  if (workbook.sales === null) plan.skippedSheets.push(SHEET_SALES);
  else plan.sales = planSales(ctx, workbook.sales, issues);
  if (workbook.shipping === null) plan.skippedSheets.push(SHEET_SHIPPING);
  else plan.shipping = planShipping(ctx, workbook.shipping, issues);
  if (workbook.purchases === null) plan.skippedSheets.push(SHEET_PURCHASES);
  else plan.purchases = planPurchases(ctx, workbook.purchases, issues);
  return plan;
}

export const planChangeCount = (plan: ImportPlan): number => plan.sales.length + plan.shipping.length + plan.purchases.length;
