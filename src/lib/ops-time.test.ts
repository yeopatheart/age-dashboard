import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bottleneck,
  cardTimes,
  countOutOfRange,
  formatClock,
  inSameDayWindow,
  formatDuration,
  leadTimeStats,
  minutesFromDayStart,
  percentile,
  slowestCards,
  summarizeDays,
  terminalLoadStats,
  windowMinutes,
  type OpsCardInput,
  type OpsItem,
} from './reports/ops-time.ts';

// KST 시각을 epoch 밀리초로.
const T = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+09:00`);
const D = '2026-11-09';

const item = (packedAt: string | null, over: Partial<OpsItem> = {}): OpsItem => ({
  changeStatus: 'none', isPacked: packedAt !== null, quantity: 1, unit: '미', unshippedQuantity: 0, packedAt: packedAt ? T(D, packedAt) : null, ...over,
});

const card = (over: Partial<OpsCardInput> = {}): OpsCardInput => ({
  id: 'c1', orderDate: D, name: '바다횟집', terminal: '대구', parcel: false, boxCount: 2, submittedAt: T(D, '09:00'),
  labels: [{ firstPrintAt: T(D, '09:10'), loadedAt: T(D, '15:00') }, { firstPrintAt: T(D, '09:20'), loadedAt: T(D, '15:30') }],
  items: [item('12:00'), item('12:30')],
  ...over,
});

test('cardTimes: 단계별 시작과 완료(라벨은 모든 박스가 처음 출력된 시각, 상차는 모든 박스가 실린 시각)', () => {
  const t = cardTimes(card());
  assert.deepEqual(t.box, { start: T(D, '09:00'), end: T(D, '09:00') });
  assert.deepEqual(t.label, { start: T(D, '09:10'), end: T(D, '09:20') });
  assert.deepEqual(t.pack, { start: T(D, '12:00'), end: T(D, '12:30') });
  assert.deepEqual(t.load, { start: T(D, '15:00'), end: T(D, '15:30') });
});

test('cardTimes: 라벨이 박스 수만큼 안 생겼거나 일부만 상차했으면 완료가 아니다', () => {
  const partialLabels = cardTimes(card({ labels: [{ firstPrintAt: T(D, '09:10'), loadedAt: null }] })); // 박스 2개인데 라벨 1장
  assert.equal(partialLabels.label.end, null);
  assert.equal(partialLabels.label.start, T(D, '09:10'));
  const partialLoad = cardTimes(card({ labels: [{ firstPrintAt: T(D, '09:10'), loadedAt: T(D, '15:00') }, { firstPrintAt: T(D, '09:20'), loadedAt: null }] }));
  assert.equal(partialLoad.load.end, null);
  assert.equal(partialLoad.load.start, T(D, '15:00'));
});

test('cardTimes: 포장은 모든 상품이 끝나야 완료, 전량 미출고 상품은 포장 체크 없이도 끝난 것', () => {
  assert.equal(cardTimes(card({ items: [item('12:00'), item(null)] })).pack.end, null);
  const shortShipped = cardTimes(card({ items: [item('12:00'), item(null, { unshippedQuantity: 1 })] }));
  assert.equal(shortShipped.pack.end, T(D, '12:00'));
  // 취소된 상품은 보지 않는다
  assert.equal(cardTimes(card({ items: [item('12:00'), item(null, { changeStatus: 'cancelled' })] })).pack.end, T(D, '12:00'));
});

test('cardTimes: 택배 카드는 라벨·상차가 없고 포장으로 끝난다', () => {
  const t = cardTimes(card({ parcel: true, labels: [], boxCount: null }));
  assert.deepEqual(t.label, { start: null, end: null });
  assert.deepEqual(t.load, { start: null, end: null });
  assert.equal(t.pack.end, T(D, '12:30'));
});

test('시각 표시: 하루 시작 기준 분, 자정 넘김, 길이', () => {
  assert.equal(minutesFromDayStart(T(D, '14:05'), D), 14 * 60 + 5);
  assert.equal(minutesFromDayStart(T('2026-11-10', '00:30'), D), 24 * 60 + 30);
  assert.equal(formatClock(14 * 60 + 5), '14:05');
  assert.equal(formatClock(24 * 60 + 30), '익일 00:30');
  assert.equal(formatDuration(45), '45분');
  assert.equal(formatDuration(120), '2시간');
  assert.equal(formatDuration(85), '1시간 25분');
  assert.equal(formatDuration(null), '-');
});

test('summarizeDays: 하루 단계 구간(첫 이벤트~가장 늦은 완료)과 완료 카드 수, 택배는 라벨·상차에서 빠진다', () => {
  const second = card({
    id: 'c2', name: '해월일식', submittedAt: T(D, '10:00'),
    labels: [{ firstPrintAt: T(D, '10:10'), loadedAt: T(D, '16:00') }, { firstPrintAt: T(D, '10:20'), loadedAt: null }], // 상차 미완료
    items: [item('13:00'), item('13:30')],
  });
  const parcel = card({ id: 'c3', name: '택배집', parcel: true, labels: [], boxCount: null, submittedAt: null, items: [item('11:00')] });
  const [day] = summarizeDays([card(), second, parcel]);
  assert.equal(day.cards, 3);
  assert.equal(day.boxes, 4);
  assert.deepEqual(day.stages.load, { start: T(D, '15:00'), end: T(D, '15:30'), done: 1, total: 2 });
  assert.deepEqual(day.stages.label, { start: T(D, '09:10'), end: T(D, '10:20'), done: 2, total: 2 });
  assert.equal(day.stages.pack.total, 3);
  assert.equal(day.stages.pack.end, T(D, '13:30'));
  assert.equal(windowMinutes(day.stages.load), 30);
  assert.equal(windowMinutes({ start: null, end: null, done: 0, total: 0 }), null);
});

test('percentile: 최근접 순위법', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10], 90), 10);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90), 90);
});

test('leadTimeStats: 구간별 건수·중앙값·평균·p90, 순서가 바뀐 카드는 빼고 센다, 택배는 제외', () => {
  const fast = card({ id: 'a' }); // 제출 09:00 → 라벨 09:20(20분) → 포장 12:30(190분) → 상차 15:30(180분)
  const slow = card({
    id: 'b', submittedAt: T(D, '09:00'),
    labels: [{ firstPrintAt: T(D, '10:00'), loadedAt: T(D, '18:00') }, { firstPrintAt: T(D, '10:30'), loadedAt: T(D, '18:30') }], // 라벨 10:30, 상차 18:30
    items: [item('09:30'), item('10:00')], // 포장이 라벨보다 먼저 끝남 → 라벨→포장은 음수
  });
  const parcel = card({ id: 'p', parcel: true, labels: [], boxCount: null, items: [item('11:00')] });
  const stats = leadTimeStats([fast, slow, parcel]);
  const byKey = Object.fromEntries(stats.map((s) => [s.key, s]));
  assert.equal(byKey['box-label'].n, 2);
  assert.equal(byKey['box-label'].median, 20); // [20, 90] → 중앙값(최근접) 20
  assert.equal(byKey['label-pack'].n, 1);
  assert.equal(byKey['label-pack'].skippedOrder, 1);
  assert.equal(byKey['label-pack'].median, 190);
  assert.equal(byKey['pack-load'].n, 2);
  assert.equal(byKey['box-load'].max, 570); // slow: 09:00 → 18:30
  assert.equal(byKey['box-load'].mean, (390 + 570) / 2);
});

test('bottleneck: 전체를 뺀 세 구간 중 중앙값이 가장 긴 구간', () => {
  const stats = leadTimeStats([card()]);
  const b = bottleneck(stats);
  assert.equal(b?.key, 'label-pack'); // 20분, 190분, 180분
  assert.equal(bottleneck(leadTimeStats([])), null);
});

test('slowestCards: 제출 → 상차 완료가 오래 걸린 순, 끝나지 않은 카드·택배는 제외', () => {
  const slow = card({ id: 'slow', name: '느린집', labels: [{ firstPrintAt: T(D, '09:10'), loadedAt: T(D, '20:00') }, { firstPrintAt: T(D, '09:20'), loadedAt: T(D, '20:30') }] });
  const unfinished = card({ id: 'u', name: '미완료', labels: [{ firstPrintAt: T(D, '09:10'), loadedAt: null }, { firstPrintAt: T(D, '09:20'), loadedAt: null }] });
  const list = slowestCards([card({ id: 'fast', name: '빠른집' }), slow, unfinished], 5);
  assert.deepEqual(list.map((c) => [c.name, c.minutes]), [['느린집', 690], ['빠른집', 390]]);
});

test('terminalLoadStats: 터미널별 하루 상차 완료 시각의 중앙값·가장 늦은 날, 박스가 덜 실린 날은 따로 센다', () => {
  const day = (date: string, loadHHMM: string, terminal = '대구'): OpsCardInput =>
    card({ id: `${terminal}-${date}`, orderDate: date, terminal, submittedAt: T(date, '09:00'), labels: [{ firstPrintAt: T(date, '09:10'), loadedAt: T(date, loadHHMM) }, { firstPrintAt: T(date, '09:20'), loadedAt: T(date, loadHHMM) }] });
  const stats = terminalLoadStats([
    day('2026-11-09', '15:00'),
    day('2026-11-10', '17:00'),
    day('2026-11-11', '16:00'),
    card({ id: 'x', orderDate: '2026-11-12', terminal: '대구', labels: [{ firstPrintAt: T('2026-11-12', '09:10'), loadedAt: null }, { firstPrintAt: T('2026-11-12', '09:20'), loadedAt: null }] }), // 미완료
    day('2026-11-09', '14:00', '인천'),
    card({ id: 'parcel', terminal: '택배', parcel: true, labels: [], boxCount: null }),
  ]);
  assert.deepEqual(stats.map((s) => s.terminal), ['대구', '인천']); // 중앙값이 늦은 순
  const daegu = stats[0];
  assert.equal(daegu.days, 3);
  assert.equal(daegu.incompleteDays, 1);
  assert.equal(daegu.median, 16 * 60);
  assert.equal(daegu.latest, 17 * 60);
  assert.equal(daegu.latestDate, '2026-11-10');
  assert.equal(daegu.medianBoxes, 2);
});

test('inSameDayWindow: 출고일 전날 정오 ~ 다음날 정오까지만 당일 작업으로 본다', () => {
  assert.equal(inSameDayWindow(T(D, '09:00'), D), true);
  assert.equal(inSameDayWindow(T('2026-11-08', '12:00'), D), true);
  assert.equal(inSameDayWindow(T('2026-11-08', '11:59'), D), false);
  assert.equal(inSameDayWindow(T('2026-11-10', '12:00'), D), true);
  assert.equal(inSameDayWindow(T('2026-11-10', '12:01'), D), false);
});

test('cardTimes: 며칠 뒤에 소급해서 넣은 시각은 알 수 없음으로 본다(박스 할당·포장·라벨·상차 모두)', () => {
  const backfilled = card({ submittedAt: T('2026-11-12', '10:00') });
  assert.deepEqual(cardTimes(backfilled).box, { start: null, end: null });
  const lateLabel = cardTimes(card({ labels: [{ firstPrintAt: T('2026-11-13', '09:00'), loadedAt: T(D, '15:00') }, { firstPrintAt: T(D, '09:20'), loadedAt: T(D, '15:30') }] }));
  assert.equal(lateLabel.label.end, null); // 한 장이 범위 밖이라 라벨 출력 완료를 알 수 없다
  assert.equal(lateLabel.label.start, T(D, '09:20'));
  const latePack = cardTimes(card({ items: [item('12:00'), { ...item(null), isPacked: true, packedAt: T('2026-11-14', '10:00') }] }));
  assert.equal(latePack.pack.end, null);
  assert.equal(latePack.pack.start, T(D, '12:00'));
  assert.equal(countOutOfRange([card(), backfilled, card({ id: 'x' })]), 1);
});
