// 정산 마감 리포트(순수 함수): 입력 완결률, 아직 비어 있는 것, 수금·지급 현황, 입력 지연.
//  - 판매내역의 "입금 여부"는 고객 입금 확인(수금), 매입내역의 "입금 여부"는 우리가 매입처에 지급한 것이다(docs/prd/settlement.md).
//  - 미수금 = 판매가를 입력했고 입금 확인이 안 된 판매내역 줄의 판매가 합. 판매가가 비어 있는 줄은 금액을 몰라 빼고 개수만 알린다.
//  - 경과일 = 오늘(KST) − 출고일.
import type { Granularity } from '../report.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { bucketKeyOf, type Bucket } from './buckets.ts';
import { baseCustomerName } from './sales-report.ts';

export interface SaleLite {
  orderDate: string;
  customer: string;
  price: number | null;
  paid: boolean;
}

export interface PurchaseLite {
  orderDate: string;
  product: string;
  price: number | null;
  paid: boolean;
  salesCount: number; // 그 (출고일 × 품목)의 판매내역 줄 수(0이면 판매는 없고 매입만 입력된 행)
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// updated_at(epoch ms)이 속한 한국 날짜.
export const kstDateOf = (ms: number): string => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ─── 입력 완결률 추이 ──────────────────────────────────────────────────────────
export interface CompletionPoint {
  bucket: Bucket;
  salesLines: number;
  salesPriced: number;
  purchaseRows: number; // 판매가 있는 (출고일 × 품목) 행
  purchasePriced: number;
  salesRate: number | null;
  purchaseRate: number | null;
}

export function completionTrend(sales: SaleLite[], purchases: PurchaseLite[], buckets: Bucket[], granularity: Granularity): CompletionPoint[] {
  const points = buckets.map((bucket) => ({ bucket, salesLines: 0, salesPriced: 0, purchaseRows: 0, purchasePriced: 0 }));
  const indexByKey = new Map(points.map((p, i) => [p.bucket.key, i]));
  for (const s of sales) {
    const i = indexByKey.get(bucketKeyOf(s.orderDate, granularity));
    if (i === undefined) continue;
    points[i].salesLines += 1;
    if (s.price !== null) points[i].salesPriced += 1;
  }
  for (const p of purchases) {
    if (p.salesCount === 0) continue; // 판매가 없는 행(매입만 입력됨)은 마감 대상이 아니다
    const i = indexByKey.get(bucketKeyOf(p.orderDate, granularity));
    if (i === undefined) continue;
    points[i].purchaseRows += 1;
    if (p.price !== null) points[i].purchasePriced += 1;
  }
  return points.map((p) => ({
    ...p,
    salesRate: p.salesLines === 0 ? null : p.salesPriced / p.salesLines,
    purchaseRate: p.purchaseRows === 0 ? null : p.purchasePriced / p.purchaseRows,
  }));
}

// ─── 아직 비어 있는 것 ─────────────────────────────────────────────────────────
export interface OpenSalesDay {
  date: string;
  lines: number; // 판매가 미입력 줄
  total: number; // 그날 판매내역 줄
}

// 판매가 미입력 줄이 있는 날(오래된 순).
export function openSalesDays(sales: SaleLite[]): OpenSalesDay[] {
  const m = new Map<string, OpenSalesDay>();
  for (const s of sales) {
    const d = m.get(s.orderDate) ?? { date: s.orderDate, lines: 0, total: 0 };
    d.total += 1;
    if (s.price === null) d.lines += 1;
    m.set(s.orderDate, d);
  }
  return [...m.values()].filter((d) => d.lines > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface OpenPurchase {
  date: string;
  product: string;
}

// 매입가 미입력 (출고일 × 품목)(오래된 순, 판매가 있는 행만).
export const openPurchases = (purchases: PurchaseLite[]): OpenPurchase[] =>
  purchases
    .filter((p) => p.salesCount > 0 && p.price === null)
    .map((p) => ({ date: p.orderDate, product: p.product }))
    .sort((a, b) => (a.date === b.date ? a.product.localeCompare(b.product, 'ko') : a.date < b.date ? -1 : 1));

// ─── 수금·지급 ────────────────────────────────────────────────────────────────
export const AGING_LABELS = ['0~3일', '4~7일', '8~14일', '15일 이상'] as const;
export const agingIndex = (days: number): number => (days <= 3 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : 3);

export interface ReceivableCustomer {
  customer: string;
  amount: number;
  lines: number;
  oldestDate: string;
  maxDays: number;
  buckets: number[]; // AGING_LABELS 순서의 금액
}

export interface Receivables {
  total: number;
  lines: number;
  customers: ReceivableCustomer[]; // 미수금이 큰 순
  buckets: number[]; // 전체의 구간별 금액
  excludedUnpriced: number; // 입금 확인이 안 됐지만 판매가가 비어 금액을 몰라 뺀 줄
}

export function receivables(sales: SaleLite[], today: string): Receivables {
  const byCustomer = new Map<string, ReceivableCustomer>();
  const out: Receivables = { total: 0, lines: 0, customers: [], buckets: AGING_LABELS.map(() => 0), excludedUnpriced: 0 };
  for (const s of sales) {
    if (s.paid) continue;
    if (s.price === null) {
      out.excludedUnpriced += 1;
      continue;
    }
    const days = Math.max(0, daysBetween(s.orderDate, today));
    const idx = agingIndex(days);
    const name = baseCustomerName(s.customer);
    const c = byCustomer.get(name) ?? { customer: name, amount: 0, lines: 0, oldestDate: s.orderDate, maxDays: days, buckets: AGING_LABELS.map(() => 0) };
    c.amount += s.price;
    c.lines += 1;
    c.buckets[idx] += s.price;
    if (s.orderDate < c.oldestDate) c.oldestDate = s.orderDate;
    c.maxDays = Math.max(c.maxDays, days);
    byCustomer.set(name, c);
    out.total += s.price;
    out.lines += 1;
    out.buckets[idx] += s.price;
  }
  out.customers = [...byCustomer.values()].sort((a, b) => b.amount - a.amount || a.customer.localeCompare(b.customer, 'ko'));
  return out;
}

// 매입 입금(지급) 표시가 안 된 매입의 합. 매입가를 입력한 행만 센다.
export function payables(purchases: PurchaseLite[]): { total: number; rows: number } {
  let total = 0;
  let rows = 0;
  for (const p of purchases) {
    if (p.paid || p.price === null) continue;
    total += p.price;
    rows += 1;
  }
  return { total, rows };
}

// ─── 입력 지연 ────────────────────────────────────────────────────────────────
export const LAG_LABELS = ['당일', '1일', '2~3일', '4~7일', '8일 이상'] as const;
const lagIndex = (days: number): number => (days <= 0 ? 0 : days === 1 ? 1 : days <= 3 ? 2 : days <= 7 ? 3 : 4);

export interface InputLag {
  n: number;
  median: number | null; // 일
  buckets: number[]; // LAG_LABELS 순서의 건수
}

// 값을 입력한 날(updated_at의 한국 날짜) − 출고일. updated_at은 마지막 수정이라, 나중에 고친 입력은 지연이 길게 보인다.
export function inputLag(entries: { orderDate: string; updatedAt: number }[]): InputLag {
  const days = entries.map((e) => Math.max(0, daysBetween(e.orderDate, kstDateOf(e.updatedAt)))).sort((a, b) => a - b);
  const buckets = LAG_LABELS.map(() => 0);
  for (const d of days) buckets[lagIndex(d)] += 1;
  return { n: days.length, median: days.length === 0 ? null : days[Math.max(0, Math.ceil(days.length / 2) - 1)], buckets };
}
