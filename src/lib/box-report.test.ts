import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketKeyOf, bucketsOf } from './reports/buckets.ts';
import { summarizeBoxUsage, weekdayIndex, type BoxUseRow } from './reports/box-usage.ts';
import {
  ACCURACY_AXES,
  accuracyTrend,
  buildAxis,
  classifyOutcome,
  outcomeCounts,
  rate,
  statOf,
  submissionHistory,
  summarizeAccuracy,
  type AccuracyRecord,
} from './reports/packing-accuracy.ts';

// ─── 버킷 ───
test('bucketsOf: 월 단위는 날짜마다, 년 단위는 12개월 버킷', () => {
  const days = bucketsOf('week', { from: '2026-11-02', to: '2026-11-08' });
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], { key: '2026-11-02', label: '11.02', from: '2026-11-02', to: '2026-11-02' });
  const months = bucketsOf('year', { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(months.length, 12);
  assert.deepEqual(months[1], { key: '2026-02', label: '2월', from: '2026-02-01', to: '2026-02-28' });
  assert.equal(bucketKeyOf('2026-11-07', 'year'), '2026-11');
  assert.equal(bucketKeyOf('2026-11-07', 'month'), '2026-11-07');
});

// ─── 박스 사용량 ───
const use = (orderDate: string, boxName: string, businessName = '바다횟집', terminalName: string | null = '대구'): BoxUseRow => ({ orderDate, boxName, businessName, terminalName });

test('weekdayIndex: 월요일=0, 일요일=6', () => {
  assert.equal(weekdayIndex('2026-11-09'), 0); // 월
  assert.equal(weekdayIndex('2026-11-15'), 6); // 일
});

test('summarizeBoxUsage: 총량·영업일 평균·종류별·버킷 집계', () => {
  const period = { from: '2026-11-09', to: '2026-11-15' };
  const rows = [use('2026-11-09', '대'), use('2026-11-09', '대'), use('2026-11-09', '소'), use('2026-11-11', '소', '해월일식', null), use('2026-11-11', '소')];
  const u = summarizeBoxUsage(rows, bucketsOf('week', period), 'week');
  assert.equal(u.total, 5);
  assert.equal(u.activeDays, 2);
  assert.equal(u.dailyAvg, 2.5);
  assert.deepEqual(u.peak, { date: '2026-11-09', count: 3 });
  assert.deepEqual(u.byType.map((t) => [t.boxName, t.count]), [['소', 3], ['대', 2]]);
  assert.equal(u.byType[0].share, 0.6);
  assert.equal(u.byType[0].perDayAvg, 1.5);
  assert.deepEqual(u.byType[0].peak, { date: '2026-11-11', count: 2 });
  // 월요일(11/9) 영업일 1일에 소 1개, 수요일(11/11) 영업일 1일에 소 2개
  assert.deepEqual(u.byType[0].weekday, [1, null, 2, null, null, null, null]);
  assert.deepEqual(u.series[0].counts, { 대: 2, 소: 1 });
  assert.deepEqual(u.series[1].counts, {});
  assert.deepEqual(u.topTerminals.map((t) => [t.name, t.count]), [['대구', 4], ['미지정', 1]]);
});

test('summarizeBoxUsage: 박스가 없으면 평균은 0, peak는 null', () => {
  const u = summarizeBoxUsage([], bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' }), 'week');
  assert.equal(u.total, 0);
  assert.equal(u.dailyAvg, 0);
  assert.equal(u.peak, null);
  assert.deepEqual(u.byType, []);
});

// ─── 정확도 ───
const rec = (over: Partial<AccuracyRecord> = {}): AccuracyRecord => ({
  id: 'r', orderDate: '2026-11-09', businessName: '바다횟집', terminalName: '대구', rank: 1, asIs: true, confidence: 'high', modelVersion: 'v1',
  boxNames: ['대'], topPlanBoxNames: ['대'], lineCount: 2, hasMulbongBox: false, productNames: ['활전갱이'], ...over,
});

test('classifyOutcome: 틀린 유형 5가지와 후보를 못 읽은 경우', () => {
  assert.equal(classifyOutcome(rec()), 'accepted');
  assert.equal(classifyOutcome(rec({ asIs: false })), 'layout');
  assert.equal(classifyOutcome(rec({ rank: 2, asIs: false })), 'alt');
  assert.equal(classifyOutcome(rec({ rank: 3, asIs: false })), 'alt');
  assert.equal(classifyOutcome(rec({ rank: null, asIs: false, boxNames: ['대', '소'], topPlanBoxNames: ['대'] })), 'count');
  assert.equal(classifyOutcome(rec({ rank: null, asIs: false, boxNames: ['소'], topPlanBoxNames: ['대'] })), 'type');
  assert.equal(classifyOutcome(rec({ rank: null, asIs: false, topPlanBoxNames: null })), 'unknown');
  assert.equal(classifyOutcome(rec({ rank: null, asIs: false, topPlanBoxNames: [] })), 'unknown');
});

test('statOf·rate·outcomeCounts', () => {
  const records = [rec(), rec({ asIs: false }), rec({ rank: 2, asIs: false }), rec({ rank: null, asIs: false, boxNames: ['소'], topPlanBoxNames: ['대'] })];
  assert.deepEqual(statOf(records), { total: 4, top1: 2, top3: 3, asIs: 1 });
  assert.equal(rate(1, 4), 0.25);
  assert.equal(rate(0, 0), null);
  assert.deepEqual(outcomeCounts(records), { accepted: 1, layout: 1, alt: 1, count: 0, type: 1, unknown: 0 });
});

test('accuracyTrend: 건수 없는 버킷은 비율이 null(0%가 아니다)', () => {
  const buckets = bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' });
  const t = accuracyTrend([rec(), rec({ asIs: false, rank: 2 })], buckets, 'week');
  assert.equal(t[0].stat.total, 2);
  assert.equal(t[0].top1, 0.5);
  assert.equal(t[0].top3, 1);
  assert.equal(t[1].stat.total, 0);
  assert.equal(t[1].top1, null);
});

test('buildAxis: 표본 3건 미만은 따로 두고, 1순위 일치율이 낮은 순으로 정렬', () => {
  const records = [
    ...Array.from({ length: 4 }, () => rec({ businessName: 'A', rank: 1 })),
    ...Array.from({ length: 3 }, () => rec({ businessName: 'B', rank: null, asIs: false })),
    rec({ businessName: 'C', rank: null, asIs: false }),
  ];
  const def = ACCURACY_AXES.find((a) => a.id === 'business')!;
  const axis = buildAxis(records, def);
  assert.deepEqual(axis.rows.map((r) => r.label), ['B', 'A']);
  assert.deepEqual(axis.small.map((r) => r.label), ['C']);
});

test('buildAxis: 순서가 정해진 축은 그 순서대로, 상품 축은 상품마다 한 번씩 센다', () => {
  const conf = buildAxis([rec({ confidence: 'low' }), rec({ confidence: 'high' })], ACCURACY_AXES.find((a) => a.id === 'confidence')!);
  assert.deepEqual(conf.rows.map((r) => r.label), ['높음', '낮음']);
  const product = buildAxis([rec({ productNames: ['a', 'b'] }), rec({ productNames: ['a'] }), rec({ productNames: ['a', 'a'] })], ACCURACY_AXES.find((a) => a.id === 'product')!, 1);
  const a = product.rows.find((r) => r.label === 'a')!;
  assert.equal(a.stat.total, 3);
});

test('submissionHistory: 카드별 첫 제출과 마지막 제출, 재제출 카드 수', () => {
  const e = (card: string, at: string, rank: number | null, asIs: boolean | null, recommendationId: string | null = 'x') => ({ dailyBusinessId: card, submittedAt: at, recommendationId, rank, asIs });
  const h = submissionHistory([
    e('c1', '2026-11-09T01:00:00Z', null, false), // 첫 제출은 추천과 달랐고
    e('c1', '2026-11-09T02:00:00Z', 1, true), // 마지막에는 추천대로
    e('c2', '2026-11-09T03:00:00Z', 1, true),
    e('c3', '2026-11-09T04:00:00Z', null, null, null), // 추천이 없던 제출은 정확도에서 뺀다
    { dailyBusinessId: null, submittedAt: '2026-11-09T05:00:00Z', recommendationId: 'x', rank: 1, asIs: true }, // 카드가 지워진 이력은 카드 수에서 뺀다
  ]);
  assert.equal(h.cards, 3);
  assert.equal(h.resubmittedCards, 1);
  assert.deepEqual(h.first, { total: 2, top1: 1, top3: 1, asIs: 1 });
  assert.deepEqual(h.final, { total: 2, top1: 2, top3: 2, asIs: 2 });
});

test('summarizeAccuracy: 전체·틀린 유형·추이·분해 축을 한 번에', () => {
  const buckets = bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' });
  const s = summarizeAccuracy([rec(), rec({ asIs: false, rank: 2 }), rec({ rank: null, asIs: false, boxNames: ['소'], topPlanBoxNames: ['대'] })], buckets, 'week');
  assert.deepEqual(s.stat, { total: 3, top1: 1, top3: 2, asIs: 1 });
  assert.equal(s.outcomes.accepted, 1);
  assert.equal(s.outcomes.alt, 1);
  assert.equal(s.outcomes.type, 1);
  assert.equal(s.trend.length, 7);
  assert.deepEqual(s.axes.map((a) => a.id), ['confidence', 'boxes', 'lines', 'mulbong', 'product', 'business', 'terminal', 'model']);
  assert.equal(s.axes[0].fixed, true);
});
