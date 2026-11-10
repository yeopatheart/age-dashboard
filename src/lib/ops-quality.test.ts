import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketsOf } from './reports/buckets.ts';
import { groupReview, inputSummary, inputTrend, reviewReasons, type InputLine, type Paste } from './reports/input-quality.ts';
import { groupLabels, labelSummary, labelTrend, type LabelRec } from './reports/label-quality.ts';

const line = (over: Partial<InputLine> = {}): InputLine => ({
  orderDate: '2026-11-09', customer: '바다횟집', terminal: '대구', product: '활전갱이', needsReview: false, reviewReason: null, aiRepaired: false, changeStatus: 'none', ...over,
});

// ─── 주문 입력 ───
test('inputSummary: 확인 필요율·AI 보정 비율·변경 현황(취소 포함 전체 줄이 분모)', () => {
  const s = inputSummary(
    [line(), line({ needsReview: true, reviewReason: '수량/단위를 찾지 못함' }), line({ needsReview: true, aiRepaired: true, changeStatus: 'modified' }), line({ changeStatus: 'cancelled' }), line({ changeStatus: 'new' })],
    [{ orderDate: '2026-11-09', round: 1 }, { orderDate: '2026-11-09', round: 2 }],
  );
  assert.equal(s.lines, 5);
  assert.equal(s.review, 2);
  assert.equal(s.reviewRate, 0.4);
  assert.equal(s.ai, 1);
  assert.equal(s.aiRate, 0.2);
  assert.equal(s.pastes, 2);
  assert.deepEqual(s.changes, { none: 2, new: 1, modified: 1, cancelled: 1 });
  assert.equal(inputSummary([], []).reviewRate, null);
});

test('inputTrend: 일별 확인 필요율·AI 보정 비율·붙여넣기 횟수(1·2차), 줄이 없는 날은 null', () => {
  const buckets = bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' });
  const pastes: Paste[] = [{ orderDate: '2026-11-09', round: 1 }, { orderDate: '2026-11-09', round: 1 }, { orderDate: '2026-11-09', round: 2 }, { orderDate: '2026-11-11', round: 1 }];
  const t = inputTrend([line(), line({ needsReview: true }), line({ orderDate: '2026-11-11', aiRepaired: true, needsReview: true })], pastes, buckets, 'week');
  assert.equal(t[0].lines, 2);
  assert.equal(t[0].reviewRate, 0.5);
  assert.equal(t[0].aiRate, 0);
  assert.deepEqual([t[0].pastes1, t[0].pastes2], [2, 1]);
  assert.equal(t[1].reviewRate, null);
  assert.equal(t[2].aiRate, 1);
  assert.deepEqual([t[2].pastes1, t[2].pastes2], [1, 0]);
});

test('reviewReasons: 확인 필요 줄만, 공백 정리, 사유 없음', () => {
  const r = reviewReasons([
    line({ needsReview: true, reviewReason: ' 수량/단위를  찾지 못함 ' }),
    line({ needsReview: true, reviewReason: '수량/단위를 찾지 못함' }),
    line({ needsReview: true }),
    line({ reviewReason: '확인 필요가 아닌 줄의 사유' }),
  ]);
  assert.deepEqual(r, [{ reason: '수량/단위를 찾지 못함', count: 2 }, { reason: '(사유 없음)', count: 1 }]);
});

test('groupReview: 확인 필요가 있는 항목만, 표본 3줄 미만은 따로, 확인 필요율 높은 순', () => {
  const lines = [
    ...Array.from({ length: 4 }, () => line({ product: 'A' })), line({ product: 'A', needsReview: true }), // A: 5줄 중 1
    ...Array.from({ length: 3 }, () => line({ product: 'B', needsReview: true })), // B: 3줄 중 3
    line({ product: 'C', needsReview: true, aiRepaired: true }), // C: 1줄(표본 부족)
    line({ product: 'D' }), // 확인 필요 없음 → 제외
  ];
  const g = groupReview(lines, (l) => l.product);
  assert.deepEqual(g.rows.map((r) => [r.label, r.review, r.lines]), [['B', 3, 3], ['A', 1, 5]]);
  assert.deepEqual(g.small.map((r) => [r.label, r.ai]), [['C', 1]]);
});

// ─── 라벨·상차 ───
const rec = (over: Partial<LabelRec> = {}): LabelRec => ({ cardId: 'c1', orderDate: '2026-11-09', customer: '바다횟집', prints: 1, scans: 1, undos: 0, ...over });

test('labelSummary: 재출력률·추가 출력·되돌리기율·재출력 카드 비율', () => {
  const s = labelSummary([
    rec({ cardId: 'a' }), // 정상
    rec({ cardId: 'a', prints: 3, scans: 2, undos: 1 }), // 재출력(추가 2회), 되돌리기 1
    rec({ cardId: 'b', prints: 2 }), // 재출력(추가 1회)
    rec({ cardId: 'c', prints: 0, scans: 0 }), // 출력 안 함(상차도 안 함) → 라벨 수에서 제외
  ]);
  assert.equal(s.labels, 3);
  assert.equal(s.reprinted, 2);
  assert.equal(s.extraPrints, 3);
  assert.equal(s.reprintRate, 2 / 3);
  assert.equal(s.scans, 4);
  assert.equal(s.undos, 1);
  assert.equal(s.undoRate, 0.25);
  assert.equal(s.cards, 2);
  assert.equal(s.cardsReprinted, 2);
  assert.equal(s.cardReprintRate, 1);
  assert.equal(labelSummary([]).reprintRate, null);
});

test('labelTrend: 일별 재출력률·되돌리기율, 라벨 없는 날은 null', () => {
  const buckets = bucketsOf('week', { from: '2026-11-09', to: '2026-11-15' });
  const t = labelTrend([rec(), rec({ prints: 2 }), rec({ orderDate: '2026-11-11', scans: 2, undos: 1 })], buckets, 'week');
  assert.equal(t[0].labels, 2);
  assert.equal(t[0].reprintRate, 0.5);
  assert.equal(t[1].reprintRate, null);
  assert.equal(t[1].undoRate, null);
  assert.equal(t[2].undoRate, 0.5);
});

test('groupLabels: 재출력·되돌리기가 있는 업체만(1·2차 합침), 표본 3라벨 미만은 따로', () => {
  const recs = [
    ...Array.from({ length: 3 }, (_, i) => rec({ customer: '엔야 1차', cardId: `e${i}`, prints: i === 0 ? 2 : 1 })), // 엔야: 라벨 3, 재출력 1
    rec({ customer: '엔야 2차', cardId: 'e9' }), // 엔야로 합쳐 라벨 4
    rec({ customer: '해월일식', undos: 1 }), // 라벨 1, 되돌리기 1 → 표본 부족
    rec({ customer: '바다횟집' }), // 문제 없음 → 제외
  ];
  const g = groupLabels(recs);
  assert.deepEqual(g.rows.map((r) => [r.label, r.labels, r.reprinted, r.undos]), [['엔야', 4, 1, 0]]);
  assert.deepEqual(g.small.map((r) => [r.label, r.undos]), [['해월일식', 1]]);
});
