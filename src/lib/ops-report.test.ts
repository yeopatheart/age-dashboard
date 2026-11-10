import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketsOf } from './reports/buckets.ts';
import { byCustomer, groupUnshipped, isFullyUnshipped, isUnshipped, reasonCounts, unshippedSummary, unshippedTrend, type OrderLine } from './reports/unshipped.ts';
import {
  agingIndex,
  completionTrend,
  daysBetween,
  inputLag,
  kstDateOf,
  openPurchases,
  openSalesDays,
  payables,
  receivables,
  type PurchaseLite,
  type SaleLite,
} from './reports/settle-close.ts';

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  orderDate: '2026-11-09', customer: '바다횟집', terminal: '대구', product: '활전갱이', quantity: 5, unit: '미', unshipped: 0, reason: null, cancelled: false, ...over,
});

// ─── 미출고 ───
test('미출고 판정: 취소·수량 미정은 대상이 아니고, 전량 미출고는 수량 이상', () => {
  assert.equal(isUnshipped(line({ unshipped: 2 })), true);
  assert.equal(isUnshipped(line({ unshipped: 2, cancelled: true })), false);
  assert.equal(isUnshipped(line({ quantity: 0, unit: '', unshipped: 0 })), false); // 수량 미정
  assert.equal(isFullyUnshipped(line({ unshipped: 5 })), true);
  assert.equal(isFullyUnshipped(line({ unshipped: 2 })), false);
});

test('unshippedSummary: 줄 수·미출고율·전량·미출고 수량(단위별)', () => {
  const s = unshippedSummary([line(), line({ unshipped: 2 }), line({ unshipped: 5 }), line({ unit: '키로', quantity: 3, unshipped: 1 }), line({ cancelled: true, unshipped: 1 })]);
  assert.equal(s.lines, 4);
  assert.equal(s.unshippedLines, 3);
  assert.equal(s.fullLines, 1);
  assert.equal(s.rate, 0.75);
  assert.deepEqual(s.quantities, [{ unit: '미', qty: 7 }, { unit: '키로', qty: 1 }]);
  assert.equal(unshippedSummary([]).rate, null);
});

test('unshippedTrend: 일별 미출고율, 줄이 없는 날은 null', () => {
  const buckets = bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' });
  const t = unshippedTrend([line(), line({ unshipped: 1 }), line({ orderDate: '2026-11-11', unshipped: 5 })], buckets, 'week');
  assert.equal(t[0].lines, 2);
  assert.equal(t[0].rate, 0.5);
  assert.equal(t[1].rate, null);
  assert.equal(t[2].rate, 1);
});

test('groupUnshipped: 미출고가 있는 항목만, 표본 3줄 미만은 따로, 미출고율 높은 순', () => {
  const lines = [
    ...Array.from({ length: 4 }, () => line({ product: 'A' })), ...[line({ product: 'A', unshipped: 1 })], // A: 5줄 중 1
    ...Array.from({ length: 3 }, () => line({ product: 'B', unshipped: 5 })), // B: 3줄 중 3
    line({ product: 'C', unshipped: 5 }), // C: 1줄 중 1(표본 부족)
    line({ product: 'D' }), // 미출고 없음 → 제외
  ];
  const g = groupUnshipped(lines, (l) => l.product);
  assert.deepEqual(g.rows.map((r) => [r.label, r.unshippedLines, r.lines, r.fullLines]), [['B', 3, 3, 3], ['A', 1, 5, 0]]);
  assert.deepEqual(g.small.map((r) => r.label), ['C']);
});

test('byCustomer: 1·2차를 합치고, reasonCounts: 공백 정리·사유 없음', () => {
  assert.equal(byCustomer(line({ customer: '엔야 2차' })), '엔야');
  const r = reasonCounts([line({ unshipped: 1, reason: ' 입고  지연 ' }), line({ unshipped: 1, reason: '입고 지연' }), line({ unshipped: 1 }), line({ unshipped: 1, reason: '' }), line()]);
  assert.deepEqual(r, [{ reason: '(사유 없음)', count: 2 }, { reason: '입고 지연', count: 2 }]);
});

// ─── 정산 마감 ───
const sale = (over: Partial<SaleLite> = {}): SaleLite => ({ orderDate: '2026-11-09', customer: '바다횟집', price: 10000, paid: false, ...over });
const pur = (over: Partial<PurchaseLite> = {}): PurchaseLite => ({ orderDate: '2026-11-09', product: '활전갱이', price: 5000, paid: false, salesCount: 1, ...over });

test('날짜 도우미: daysBetween, kstDateOf(자정 넘김)', () => {
  assert.equal(daysBetween('2026-11-09', '2026-11-12'), 3);
  assert.equal(daysBetween('2026-11-09', '2026-11-09'), 0);
  assert.equal(kstDateOf(Date.parse('2026-11-09T15:30:00Z')), '2026-11-10'); // UTC 15:30 = KST 다음날 00:30
  assert.equal(kstDateOf(Date.parse('2026-11-09T14:59:00Z')), '2026-11-09');
});

test('completionTrend: 판매가·매입가 입력률, 판매 없는 매입 행은 마감 대상이 아니다', () => {
  const buckets = bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' });
  const t = completionTrend([sale(), sale({ price: null }), sale({ price: null })], [pur(), pur({ product: 'b', price: null }), pur({ product: 'c', price: null, salesCount: 0 })], buckets, 'week');
  assert.equal(t[0].salesLines, 3);
  assert.equal(t[0].salesRate, 1 / 3);
  assert.equal(t[0].purchaseRows, 2);
  assert.equal(t[0].purchaseRate, 0.5);
  assert.equal(t[1].salesRate, null);
});

test('openSalesDays·openPurchases: 오래된 순', () => {
  const days = openSalesDays([sale({ orderDate: '2026-11-10', price: null }), sale({ orderDate: '2026-11-09', price: null }), sale({ orderDate: '2026-11-09' }), sale({ orderDate: '2026-11-11' })]);
  assert.deepEqual(days, [{ date: '2026-11-09', lines: 1, total: 2 }, { date: '2026-11-10', lines: 1, total: 1 }]);
  const open = openPurchases([pur({ orderDate: '2026-11-10', product: 'z', price: null }), pur({ orderDate: '2026-11-09', product: 'b', price: null }), pur({ price: null, salesCount: 0 }), pur()]);
  assert.deepEqual(open, [{ date: '2026-11-09', product: 'b' }, { date: '2026-11-10', product: 'z' }]);
});

test('agingIndex: 0~3 / 4~7 / 8~14 / 15+', () => {
  assert.deepEqual([0, 3, 4, 7, 8, 14, 15, 40].map(agingIndex), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test('receivables: 입금 안 된 판매가만, 고객별·구간별 합, 판매가 없는 줄은 뺀다', () => {
  const today = '2026-11-20';
  const r = receivables(
    [
      sale({ orderDate: '2026-11-19', price: 10000 }), // 1일
      sale({ orderDate: '2026-11-05', price: 30000 }), // 15일
      sale({ orderDate: '2026-11-19', price: 5000, paid: true }), // 입금됨 → 제외
      sale({ customer: '엔야 2차', orderDate: '2026-11-12', price: 20000 }), // 8일
      sale({ customer: '엔야', orderDate: '2026-11-18', price: 1000 }), // 2일, 차수 합침
      sale({ orderDate: '2026-11-19', price: null }), // 금액 모름 → 제외하고 개수만
    ],
    today,
  );
  assert.equal(r.total, 61000);
  assert.equal(r.lines, 4);
  assert.equal(r.excludedUnpriced, 1);
  assert.deepEqual(r.buckets, [11000, 0, 20000, 30000]);
  assert.deepEqual(r.customers.map((c) => [c.customer, c.amount, c.lines, c.oldestDate, c.maxDays]), [['바다횟집', 40000, 2, '2026-11-05', 15], ['엔야', 21000, 2, '2026-11-12', 8]]);
  assert.deepEqual(r.customers[0].buckets, [10000, 0, 0, 30000]);
});

test('payables: 지급 표시가 안 된 매입(매입가가 있는 행만)', () => {
  assert.deepEqual(payables([pur(), pur({ price: 7000 }), pur({ paid: true }), pur({ price: null })]), { total: 12000, rows: 2 });
});

test('inputLag: 입력일 − 출고일의 분포와 중앙값(KST 날짜 기준)', () => {
  const at = (iso: string) => Date.parse(iso);
  const lag = inputLag([
    { orderDate: '2026-11-09', updatedAt: at('2026-11-09T05:00:00Z') }, // 당일
    { orderDate: '2026-11-09', updatedAt: at('2026-11-09T15:30:00Z') }, // KST 다음날 → 1일
    { orderDate: '2026-11-09', updatedAt: at('2026-11-11T05:00:00Z') }, // 2일
    { orderDate: '2026-11-09', updatedAt: at('2026-11-20T05:00:00Z') }, // 11일
  ]);
  assert.equal(lag.n, 4);
  assert.deepEqual(lag.buckets, [1, 1, 1, 0, 1]);
  assert.equal(lag.median, 1);
  assert.equal(inputLag([]).median, null);
});
