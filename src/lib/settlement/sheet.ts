// 정산표(엑셀처럼 한 장으로 입력하는 화면)의 순수 로직: 고객 묶음 만들기, 칸에 적은 글자를 저장할 값으로 바꾸기, 엑셀에서 복사한 글자 나누기.
// 화면(sheet-client.tsx)은 칸 하나 수정·여러 칸 붙여넣기·아래로 채우기를 모두 editLine / editShipping 한 길로 처리한다. 결정은 docs/decisions/2026-11-14-settlement-sheet.md.
import type { SalesRow } from './sales.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { MAX_PRODUCT_LEN, MAX_QUANTITY, MAX_UNIT_LEN, type SalesLineFields } from './sales-edit.ts';
import { amountFromUnitPrice, canAutoFillPrice } from './receipt.ts';
import { MAX_BOXES, suggestAmount, type ShippingRow } from './shipping.ts';
import { parseWon, wonInputError } from '../money.ts';

// 표의 열(왼쪽부터). 배송비 줄은 수량(박스 수)·판매가(배송비)·메모 칸만 있다.
export const SHEET_COLS = ['product', 'quantity', 'unit', 'unitPrice', 'price', 'memo'] as const;
export type SheetCol = (typeof SHEET_COLS)[number];
export const SHIPPING_COLS: readonly SheetCol[] = ['quantity', 'price', 'memo'];

// 그날 고객 카드 하나의 묶음: 상품 줄 + 배송비 줄. 사업자구분·입금은 카드 단위 값이다.
export interface SheetGroup {
  cardId: string;
  customer: string;
  terminal: string;
  sellerId: string | null;
  paid: boolean;
  lines: SalesRow[];
  shipping: ShippingRow[];
}

// 판매 줄이 나온 순서(카드 순서)대로 묶고, 배송비 줄을 같은 카드에 붙인다. 판매 줄 없이 배송비만 있는 카드는 뒤에 둔다.
export function buildGroups(sales: SalesRow[], shipping: ShippingRow[]): SheetGroup[] {
  const byCard = new Map<string, SheetGroup>();
  for (const r of sales) {
    let g = byCard.get(r.cardId);
    if (!g) {
      g = { cardId: r.cardId, customer: r.customer, terminal: r.terminal, sellerId: r.sellerId, paid: r.paid, lines: [], shipping: [] };
      byCard.set(r.cardId, g);
    }
    g.lines.push(r);
  }
  for (const s of shipping) {
    let g = byCard.get(s.cardId);
    if (!g) {
      g = { cardId: s.cardId, customer: s.customer, terminal: s.terminal, sellerId: s.sellerId, paid: s.paid, lines: [], shipping: [] };
      byCard.set(s.cardId, g);
    }
    g.shipping.push(s);
  }
  return [...byCard.values()];
}

// 고객 합계: 판매가를 입력한 상품 줄 + 배송비(자동 산정 포함, 뺀 줄은 0원)
export function groupTotals(g: SheetGroup): { goods: number; shipping: number; total: number; unpriced: number } {
  const goods = g.lines.reduce((sum, l) => sum + (l.price ?? 0), 0);
  const shipping = g.shipping.reduce((sum, s) => sum + (s.amount ?? 0), 0);
  return { goods, shipping, total: goods + shipping, unpriced: g.lines.filter((l) => l.price === null).length };
}

// 수량 칸: "1.1", "1,200.5" 같은 숫자(소수 둘째 자리까지). 아니면 null.
function parseQuantity(text: string): number | null {
  const t = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const q = Number(t);
  return q > 0 && q <= MAX_QUANTITY ? q : null;
}

export type CellError = { error: string };
export interface LineEdit {
  fields: SalesLineFields; // 서버에 보낼 값
  view: Partial<SalesRow>; // 화면에 바로 보일 값
}

// 상품 줄의 한 칸에 적은 글자를 저장할 값으로 바꾼다. 바뀐 것이 없으면 null, 잘못된 값이면 { error }.
//  - 품목·수량·단위: 비우면 주문 목록 값으로 되돌린다. 주문 목록 값과 같아지면 수정값을 지운다(null).
//  - 단가·판매가: 비우면 값을 지운다. 단가나 수량을 고치면, 판매가가 비어 있거나 이전 단가 × 수량 그대로일 때 판매가를 다시 계산한다(직접 적은 판매가는 건드리지 않는다).
export function editLine(row: SalesRow, col: SheetCol, text: string): LineEdit | CellError | null {
  const t = (col === 'unitPrice' || col === 'price' ? text.replace(/₩/g, '') : text).trim(); // 엑셀의 통화 서식(₩1,000)을 그대로 붙여넣을 수 있게
  const o = row.original;
  const withEdited = (view: Partial<SalesRow>): Partial<SalesRow> => {
    const next = { product: view.product ?? row.product, quantity: view.quantity ?? row.quantity, unit: view.unit ?? row.unit };
    return { ...view, edited: next.product !== o.product || next.quantity !== o.quantity || next.unit !== o.unit };
  };
  if (col === 'product' || col === 'unit') {
    const max = col === 'product' ? MAX_PRODUCT_LEN : MAX_UNIT_LEN;
    const value = t === '' ? o[col] : t;
    if (value.length > max) return { error: `${col === 'product' ? '품목명' : '단위'}은 ${max}자 이하로 입력해주세요.` };
    if (value === row[col]) return null;
    return { fields: { [col]: value === o[col] ? null : value }, view: withEdited({ [col]: value }) };
  }
  if (col === 'quantity') {
    const q = t === '' ? o.quantity : parseQuantity(t);
    if (q === null) return { error: `수량이 올바르지 않습니다: ${t} (0보다 크고 ${MAX_QUANTITY.toLocaleString('ko-KR')} 이하, 소수 둘째 자리까지)` };
    if (q === row.quantity) return null;
    const fields: SalesLineFields = { quantity: q === o.quantity ? null : q };
    const view: Partial<SalesRow> = { quantity: q };
    if (row.unitPrice !== null && canAutoFillPrice(row.price, row.unitPrice, row.quantity)) {
      fields.price = amountFromUnitPrice(row.unitPrice, q);
      view.price = fields.price;
    }
    return { fields, view: withEdited(view) };
  }
  if (col === 'unitPrice' || col === 'price') {
    const problem = wonInputError(t);
    if (problem) return { error: `${col === 'unitPrice' ? '단가' : '판매가'}: ${problem}` };
    const next = parseWon(t);
    if (next === row[col]) return null;
    const fields: SalesLineFields = { [col]: next };
    const view: Partial<SalesRow> = { [col]: next };
    if (col === 'unitPrice' && next !== null && canAutoFillPrice(row.price, row.unitPrice, row.quantity)) {
      fields.price = amountFromUnitPrice(next, row.quantity);
      view.price = fields.price;
    }
    return { fields, view };
  }
  if (t.length > 500) return { error: '메모는 500자 이하로 입력해주세요.' };
  if (t === row.memo) return null;
  return { fields: { memo: t }, view: { memo: t } };
}

// 배송비 줄의 한 칸에 적은 글자를 반영한 줄(저장할 전체 값). 바뀐 것이 없으면 null, 잘못된 값이면 { error }. 배송비 줄에 없는 칸은 null.
//  - 수량 칸 = 박스 수. 아직 저장하지 않은 자동 산정 줄이면 박스 수에 맞춰 금액도 다시 계산한다.
//  - 판매가 칸 = 배송비 금액. 비우면 0원(그날 뺀 것과 같다).
export function editShipping(row: ShippingRow, col: SheetCol, text: string): { next: ShippingRow } | CellError | null {
  const t = (col === 'price' ? text.replace(/₩/g, '') : text).trim();
  if (col === 'quantity') {
    if (t === '') return null;
    const boxes = /^\d+$/.test(t.replace(/,/g, '')) ? Number(t.replace(/,/g, '')) : NaN;
    if (!Number.isInteger(boxes) || boxes > MAX_BOXES) return { error: `박스 수가 올바르지 않습니다: ${t} (0~${MAX_BOXES.toLocaleString('ko-KR')} 사이 정수)` };
    if (boxes === row.boxes) return null;
    return { next: { ...row, boxes, amount: !row.saved && row.rate !== null ? suggestAmount(row.rate, boxes) : row.amount, saved: true } };
  }
  if (col === 'price') {
    const problem = wonInputError(t);
    if (problem) return { error: `배송비: ${problem}` };
    const amount = parseWon(t) ?? 0;
    if (amount === row.amount && row.saved) return null;
    return { next: { ...row, amount, saved: true } };
  }
  if (col === 'memo') {
    if (t.length > 500) return { error: '메모는 500자 이하로 입력해주세요.' };
    if (t === row.memo) return null;
    return { next: { ...row, memo: t, saved: true } };
  }
  return null;
}

// 한 줄의 여러 칸을 한꺼번에 고친다(여러 칸 붙여넣기). 앞 칸의 결과를 반영한 줄에 다음 칸을 적용해서, 수량과 단가를 같이 붙여넣어도 판매가가 한 번에 맞게 계산된다.
export function editLineCells(row: SalesRow, cells: [SheetCol, string][]): LineEdit | CellError | null {
  let current = row;
  let fields: SalesLineFields = {};
  let view: Partial<SalesRow> = {};
  for (const [col, text] of cells) {
    const edit = editLine(current, col, text);
    if (edit === null) continue;
    if ('error' in edit) return edit;
    fields = { ...fields, ...edit.fields };
    view = { ...view, ...edit.view };
    current = { ...current, ...edit.view };
  }
  return Object.keys(fields).length === 0 ? null : { fields, view };
}

export function editShippingCells(row: ShippingRow, cells: [SheetCol, string][]): { next: ShippingRow } | CellError | null {
  let current = row;
  let changed = false;
  for (const [col, text] of cells) {
    const edit = editShipping(current, col, text);
    if (edit === null) continue;
    if ('error' in edit) return edit;
    current = edit.next;
    changed = true;
  }
  return changed ? { next: current } : null;
}

// 엑셀·구글 시트에서 복사한 글자(줄은 줄바꿈, 칸은 탭)를 2차원으로 나눈다. 맨 끝의 빈 줄은 뺀다.
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.split('\t'));
}

// 여러 칸을 복사한 것인지(탭이나 줄바꿈이 있는지). 한 칸이면 브라우저 기본 붙여넣기에 맡긴다.
export const isMultiCell = (text: string): boolean => parseClipboard(text).length > 1 || text.includes('\t');
