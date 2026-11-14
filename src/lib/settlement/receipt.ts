// 정산 판매내역 → 영수증 만들기(순수 함수). 영수증 한 장은 고객사 × 사업자 × 출고일이다(결정: docs/decisions/2026-11-06-settlement-receipt.md).
// 서버(발행·스냅샷 저장)와 화면(미리보기·이력)이 같이 쓴다.

import { shippingLabel, shippingUnitPrice, type ShippingRow } from './shipping.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

// 영수증 품목표의 한 장당 행 수. 넘으면 여러 장으로 나눈다(기존 Auto-Receipt와 같은 15행).
export const RECEIPT_PAGE_ROWS = 15;

// 영수증을 만들 후보 줄 — 정산 판매내역의 한 줄(SalesRow)에 입력한 단가를 붙인 것이다.
export interface ReceiptSourceRow {
  itemId: string;
  orderDate: string; // 출고일 YYYY-MM-DD
  customer: string;
  product: string;
  quantity: number; // 출고 수량
  unit: string;
  sellerId: string | null;
  price: number | null; // 판매가: 그 줄의 총액(원). null이면 아직 입력 전
  unitPrice: number | null; // 단가(원). 비어 있으면 영수증 단가 칸이 빈칸
}

export type ReceiptSkipReason = 'no-seller' | 'no-price';

export interface SkippedRow {
  row: ReceiptSourceRow;
  reason: ReceiptSkipReason;
}

// 같은 고객·사업자·출고일의 줄 묶음. 사업자와 판매가가 모두 있는 줄만 들어온다.
export interface ReceiptGroup {
  key: string;
  orderDate: string;
  customer: string;
  sellerId: string;
  rows: (ReceiptSourceRow & { price: number })[];
}

// 선택한 줄을 영수증 단위로 묶는다. 사업자가 없거나 판매가가 비어 있는 줄은 영수증에 넣지 않고 사유와 함께 돌려준다.
// 정렬: 출고일 → 고객명(가나다) → 처음 나온 순서. 묶음 안 줄 순서는 입력 순서를 지킨다.
export function groupForReceipts(rows: ReceiptSourceRow[]): { groups: ReceiptGroup[]; skipped: SkippedRow[] } {
  const skipped: SkippedRow[] = [];
  const byKey = new Map<string, ReceiptGroup>();
  for (const row of rows) {
    if (row.sellerId === null) {
      skipped.push({ row, reason: 'no-seller' });
      continue;
    }
    if (row.price === null) {
      skipped.push({ row, reason: 'no-price' });
      continue;
    }
    const key = `${row.orderDate}|${row.sellerId}|${row.customer}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, orderDate: row.orderDate, customer: row.customer, sellerId: row.sellerId, rows: [] };
      byKey.set(key, group);
    }
    group.rows.push({ ...row, price: row.price });
  }
  const groups = [...byKey.values()].sort(
    (a, b) => (a.orderDate === b.orderDate ? 0 : a.orderDate < b.orderDate ? -1 : 1) || a.customer.localeCompare(b.customer, 'ko'),
  );
  return { groups, skipped };
}

// 배송비 줄을 영수증 품목 줄로 바꾼다("버스 · 3박스 · 30,000원"). 스냅샷 모양(ReceiptLine)을 바꾸지 않고 품목 줄로 들어간다.
// 터미널 설정으로 자동 산정한 줄도 들어간다(발행할 때 서버가 그 줄을 저장해 금액을 고정한다). 0원인 줄(그날 뺀 수단)은 넣지 않는다(null).
export function shippingReceiptRow(row: ShippingRow): ReceiptSourceRow | null {
  if (row.amount === null || row.amount <= 0) return null;
  return {
    itemId: `ship:${row.key}`,
    orderDate: row.orderDate,
    customer: row.customer,
    product: shippingLabel(row.method),
    quantity: row.boxes,
    unit: '박스',
    sellerId: row.sellerId,
    price: row.amount,
    unitPrice: shippingUnitPrice(row.amount, row.boxes),
  };
}

// 영수증 묶음(고객 × 사업자 × 출고일)마다 같은 묶음의 배송비 줄을 맨 뒤에 붙인다. 판매 줄이 없는 묶음은 만들지 않는다(배송비만으로 영수증을 만들지 않는다).
export function attachShippingLines(groups: ReceiptGroup[], shipping: ReceiptSourceRow[]): ReceiptGroup[] {
  const byKey = new Map<string, (ReceiptSourceRow & { price: number })[]>();
  for (const r of shipping) {
    if (r.sellerId === null || r.price === null) continue;
    const key = `${r.orderDate}|${r.sellerId}|${r.customer}`;
    const list = byKey.get(key) ?? [];
    list.push({ ...r, price: r.price });
    byKey.set(key, list);
  }
  return groups.map((g) => (byKey.has(g.key) ? { ...g, rows: [...g.rows, ...byKey.get(g.key)!] } : g));
}

// ── 발행 스냅샷(settlement_receipts.snapshot에 저장하는 모양) ──────────────────────────────────

// 공급자(우리 쪽 사업자) 정보. 직인 이미지는 용량 때문에 스냅샷에 넣지 않는다.
export interface ReceiptSeller {
  name: string;
  registrationNo: string; // 숫자 10자리
  representative: string | null;
  address: string | null;
  businessType: string | null; // 업태
  businessItem: string | null; // 종목
}

export interface ReceiptLine {
  product: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  amount: number; // 공급대가(금액) = 판매가
}

export interface ReceiptSnapshot {
  version: 1;
  orderDate: string;
  customerName: string;
  seller: ReceiptSeller;
  lines: ReceiptLine[];
  total: number;
}

export function buildSnapshot(group: ReceiptGroup, seller: ReceiptSeller): ReceiptSnapshot {
  const lines: ReceiptLine[] = group.rows.map((r) => ({
    product: r.product,
    quantity: r.quantity,
    unit: r.unit,
    unitPrice: r.unitPrice,
    amount: r.price,
  }));
  return { version: 1, orderDate: group.orderDate, customerName: group.customer, seller, lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
}

// DB(jsonb)에서 읽은 값이 ReceiptSnapshot 모양인지 확인한다. 아니면 null — 이력 화면이 "열 수 없음"으로 보여 주고 화면이 죽지 않게 한다.
export function parseSnapshot(value: unknown): ReceiptSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown): x is string => typeof x === 'string';
  const optStr = (x: unknown) => x === null || typeof x === 'string';
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (v.version !== 1 || !str(v.orderDate) || !str(v.customerName) || !num(v.total) || !Array.isArray(v.lines)) return null;
  const sellerRaw = v.seller;
  if (typeof sellerRaw !== 'object' || sellerRaw === null) return null;
  const seller = sellerRaw as Record<string, unknown>;
  if (!str(seller.name) || !str(seller.registrationNo) || !optStr(seller.representative) || !optStr(seller.address) || !optStr(seller.businessType) || !optStr(seller.businessItem)) return null;
  const lines: ReceiptLine[] = [];
  for (const raw of v.lines) {
    if (typeof raw !== 'object' || raw === null) return null;
    const l = raw as Record<string, unknown>;
    if (!str(l.product) || !num(l.quantity) || !str(l.unit) || !(l.unitPrice === null || num(l.unitPrice)) || !num(l.amount)) return null;
    lines.push({ product: l.product, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount });
  }
  return {
    version: 1,
    orderDate: v.orderDate,
    customerName: v.customerName,
    seller: {
      name: seller.name,
      registrationNo: seller.registrationNo,
      representative: seller.representative as string | null,
      address: seller.address as string | null,
      businessType: seller.businessType as string | null,
      businessItem: seller.businessItem as string | null,
    },
    lines,
    total: v.total,
  };
}

// ── 화면용 ────────────────────────────────────────────────────────────────────────────────

// 품목 줄을 한 장당 행 수(기본 15)로 나눈다. 줄이 없어도 빈 한 장은 돌려준다.
export function splitPages<T>(items: T[], size = RECEIPT_PAGE_ROWS): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

// 영수증 왼쪽 위의 번호. 한 장이면 "7", 여러 장으로 나뉘면 "7-1", "7-2".
export function pageNumberLabel(receiptNo: number, pageIndex: number, pageCount: number): string {
  return pageCount <= 1 ? String(receiptNo) : `${receiptNo}-${pageIndex + 1}`;
}

// 수량 칸: 숫자 뒤에 단위를 붙인다(예: 5미, 2kg, 0.5kg). 소수 셋째 자리까지만 쓰고 끝의 0은 지운다.
export function formatQuantity(quantity: number, unit: string): string {
  return `${Number(quantity.toFixed(3))}${unit}`;
}

// 단가를 입력하면 판매가를 단가 × 수량으로 채운다(원 단위 반올림). 판매가는 그 뒤에도 직접 고칠 수 있다.
export function amountFromUnitPrice(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity);
}

// 단가를 새로 입력할 때 판매가를 자동으로 채워도 되는지. 판매가가 비어 있거나, 이전 단가 × 수량으로 자동 계산된 값 그대로일 때만 true다.
// 사용자가 판매가를 따로 적어 둔 경우(할인가 등)에는 덮어쓰지 않는다.
export function canAutoFillPrice(price: number | null, previousUnitPrice: number | null, quantity: number): boolean {
  if (price === null) return true;
  return previousUnitPrice !== null && price === amountFromUnitPrice(previousUnitPrice, quantity);
}

// 이미 발행한 영수증의 식별 정보(이력 목록에서 가져온다).
export interface IssuedReceiptKey {
  orderDate: string;
  customerName: string;
  sellerId: string | null;
  receiptNo: number;
}

// 발행하려는 묶음 중 같은 출고일·고객·사업자로 이미 발행한 영수증이 있는 것을 찾는다(묶음 key → 기존 NO. 목록).
// DB의 customer_name은 60자까지만 저장되므로 같은 기준으로 비교한다.
export function findDuplicateReceipts(groups: ReceiptGroup[], issued: IssuedReceiptKey[]): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const g of groups) {
    const nos = issued
      .filter((r) => r.orderDate === g.orderDate && r.sellerId === g.sellerId && r.customerName === g.customer.slice(0, 60))
      .map((r) => r.receiptNo)
      .sort((a, b) => a - b);
    if (nos.length > 0) found.set(g.key, nos);
  }
  return found;
}

// 이미지 파일 이름: 영수증_2026-11-14_고객명.png (여러 장이면 _1, _2). 파일 이름에 못 쓰는 글자는 뺀다.
export function receiptFileName(orderDate: string, customer: string, pageIndex = 0, pageCount = 1): string {
  const safe = customer.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || '고객';
  return `영수증_${orderDate}_${safe}${pageCount > 1 ? `_${pageIndex + 1}` : ''}.png`;
}
