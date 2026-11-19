import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boardGridTemplate,
  buildHistoryIndex,
  businessIdsInBothRounds,
  cardIsCancelled,
  cardIsComplete,
  driftMinutes,
  formatKst,
  itemIsUndecided,
  groupLabel,
  groupOfMonitor,
  cardsOfGroup,
  parseMeta,
  parseSummary,
  productSlotCount,
} from './ink/history-view.ts';

const v2Card = {
  id: 'c1',
  number: 2,
  name: '스시미로',
  default_name: '스시미로',
  business_id: 'b1',
  sort: 1,
  round: 2,
  terminal: '대구',
  separate: false,
  parcel: false,
  total_boxes: 3,
  items: [
    { id: 'i1', seq: 1, name: '활전갱이', qty: 5, unit: '미', size: '(키로 2미)', status: 'modified', packed: true, unshipped_qty: 2, unshipped_reason: '품절', mulbong: true, aerator: false },
    { id: 'i2', seq: 2, name: '돌문어', qty: 10, unit: '미', size: null, status: 'none', packed: false },
  ],
};

test('parseSummary: v2 카드와 상품의 모든 값을 읽는다', () => {
  const cards = parseSummary([v2Card]);
  assert.ok(cards);
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.deepEqual({ id: c.id, number: c.number, name: c.name, businessId: c.businessId, round: c.round, terminal: c.terminal, totalBoxes: c.totalBoxes, separate: c.separate, parcel: c.parcel }, { id: 'c1', number: 2, name: '스시미로', businessId: 'b1', round: 2, terminal: '대구', totalBoxes: 3, separate: false, parcel: false });
  assert.equal(c.items.length, 2);
  assert.deepEqual(c.items[0], { id: 'i1', seq: 1, name: '활전갱이', qty: 5, unit: '미', size: '(키로 2미)', status: 'modified', packed: true, unshipped: 2, unshippedReason: '품절', isMulbong: true, hasAerator: false });
  assert.equal(c.items[1].unshipped, 0);
  assert.equal(c.items[1].size, null);
});

test('parseSummary: 옛 형식(v1)은 빠진 값을 기본값으로 읽는다', () => {
  const cards = parseSummary([{ id: 'c1', number: 5, name: '가게', sort: 1, round: 1, items: [{ id: 'i1', seq: 1, name: '방어', qty: 7, unit: '박스', size: null, status: 'none', packed: false }] }]);
  assert.ok(cards);
  assert.equal(cards[0].terminal, '');
  assert.equal(cards[0].businessId, null);
  assert.equal(cards[0].totalBoxes, null);
  assert.equal(cards[0].separate, false);
  assert.equal(cards[0].items[0].isMulbong, false);
});

test('parseSummary: 배열이 아니면 null, 읽을 수 없는 카드·상품은 건너뛴다', () => {
  assert.equal(parseSummary(null), null);
  assert.equal(parseSummary({}), null);
  assert.equal(parseSummary('x'), null);
  assert.deepEqual(parseSummary([]), []);
  const cards = parseSummary([null, 3, { name: 'id 없음' }, { id: '', items: [] }, { id: 'ok', items: [null, { id: '' }, { id: 'i', name: '상품', qty: '1.5', unit: 'kg', status: '이상한값' }] }]);
  assert.ok(cards);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].items.length, 1);
  assert.equal(cards[0].items[0].qty, 1.5); // 숫자 글자는 숫자로
  assert.equal(cards[0].items[0].status, 'none'); // 모르는 상태는 none
});

test('parseMeta: 터미널·상품 색을 읽고 없으면 비운다', () => {
  assert.deepEqual(parseMeta(null), { terminals: {}, products: {} });
  assert.deepEqual(parseMeta('x'), { terminals: {}, products: {} });
  const meta = parseMeta({ terminals: { 대구: { fill: 'blue', border: 'blue', separate: false }, 이상: 3 }, products: { 활전갱이: { fill: 'orange', border: null } }, highlights: ['x'] });
  assert.deepEqual(meta.terminals, { 대구: { fill: 'blue', border: 'blue' } });
  assert.deepEqual(meta.products, { 활전갱이: { fill: 'orange', border: null } });
});

test('productSlotCount와 boardGridTemplate: 상품 열 수와 칠판과 같은 앞 4열', () => {
  assert.equal(productSlotCount([]), 1);
  const cards = parseSummary([v2Card, { id: 'c2', items: [] }]) ?? [];
  assert.equal(productSlotCount(cards), 2);
  assert.equal(boardGridTemplate(3), '44px 76px minmax(150px, 1.3fr) 64px repeat(3, minmax(104px, 1fr))');
});

test('businessIdsInBothRounds: 1차·2차가 모두 있는 업체만, 업체 id가 없으면 제외', () => {
  const cards = parseSummary([
    { id: 'a', business_id: 'b1', round: 1, items: [] },
    { id: 'b', business_id: 'b1', round: 2, items: [] },
    { id: 'c', business_id: 'b2', round: 1, items: [] },
    { id: 'd', round: 1, items: [] },
    { id: 'e', round: 2, items: [] },
  ]) ?? [];
  assert.deepEqual([...businessIdsInBothRounds(cards)], ['b1']);
});

test('완료·취소·미정 판정은 주문 목록의 규칙을 그대로 쓴다', () => {
  const [card] = parseSummary([v2Card]) ?? [];
  assert.equal(cardIsComplete(card), false); // i2가 아직 포장 전
  const done = parseSummary([{ ...v2Card, items: v2Card.items.map((i) => ({ ...i, packed: true })) }]) ?? [];
  assert.equal(cardIsComplete(done[0]), true);
  const undecided = parseSummary([{ id: 'u', items: [{ id: 'i', name: '활전갱이', qty: 0, unit: '', status: 'none', packed: true }] }]) ?? [];
  assert.equal(itemIsUndecided(undecided[0].items[0]), true);
  assert.equal(cardIsComplete(undecided[0]), false); // 수량 미정이면 완료가 아니다
  const cancelled = parseSummary([{ id: 'x', items: [{ id: 'i', name: 'a', qty: 1, unit: '미', status: 'cancelled', packed: false }] }]) ?? [];
  assert.equal(cardIsCancelled(cancelled[0]), true);
});

test('buildHistoryIndex: 날짜는 최신순, 모니터는 1·2·s1·s2 순', () => {
  const idx = buildHistoryIndex([
    { order_date: '2026-11-17', monitor: 's2' },
    { order_date: '2026-11-18', monitor: '2' },
    { order_date: '2026-11-17', monitor: '1' },
    { order_date: '2026-11-17', monitor: 's1' },
    { order_date: '2026-11-18', monitor: '1' },
    { order_date: '2026-11-18', monitor: '1' },
  ]);
  assert.deepEqual(idx.dates, ['2026-11-18', '2026-11-17']);
  assert.deepEqual(idx.monitorsByDate['2026-11-18'], ['1', '2']);
  assert.deepEqual(idx.monitorsByDate['2026-11-17'], ['1', 's1', 's2']);
  assert.deepEqual(buildHistoryIndex([]), { dates: [], monitorsByDate: {} });
});

test('groupOfMonitor·groupLabel: 모니터 1·2는 버스 주문, 그 밖(s1·s2)은 별도 주문', () => {
  assert.equal(groupOfMonitor('1'), 'bus');
  assert.equal(groupOfMonitor('2'), 'bus');
  assert.equal(groupOfMonitor('s1'), 'sep');
  assert.equal(groupOfMonitor('s2'), 'sep');
  assert.equal(groupOfMonitor('x'), 'sep');
  assert.equal(groupLabel('bus'), '버스 주문');
  assert.equal(groupLabel('sep'), '별도 주문');
});

test('cardsOfGroup: 별도·택배 카드는 별도 주문, 나머지는 버스 주문', () => {
  const cards = [
    { id: 'a', separate: false, parcel: false },
    { id: 'b', separate: true, parcel: false },
    { id: 'c', separate: false, parcel: true },
    { id: 'd', separate: true, parcel: true },
  ];
  assert.deepEqual(cardsOfGroup(cards, 'bus').map((c) => c.id), ['a']);
  assert.deepEqual(cardsOfGroup(cards, 'sep').map((c) => c.id), ['b', 'c', 'd']);
  assert.deepEqual(cardsOfGroup([], 'bus'), []);
});

test('formatKst: UTC를 한국 시간으로', () => {
  assert.equal(formatKst('2026-11-17T20:06:41.657371+00:00'), '11-18 05:06');
  assert.equal(formatKst('2026-11-18T00:20:00Z'), '11-18 09:20');
  assert.equal(formatKst('이상한 값'), '');
});

test('driftMinutes: 정기(v2)는 어긋나지 않고, 급감·옛 형식은 저장 시각과의 차이를 알린다', () => {
  assert.equal(driftMinutes('interval', 2, '2026-11-18T00:00:00Z', '2026-11-18T01:00:00Z'), null);
  assert.equal(driftMinutes('drop', 2, '2026-11-18T00:00:00Z', '2026-11-18T00:45:00Z'), 45);
  assert.equal(driftMinutes('interval', 1, '2026-11-18T00:00:00Z', '2026-11-18T00:30:00Z'), 30);
  assert.equal(driftMinutes('drop', 2, '2026-11-18T00:00:00Z', '2026-11-18T00:00:30Z'), null); // 1분 안
  assert.equal(driftMinutes('drop', 2, '이상', '2026-11-18T00:00:30Z'), null);
});

import { needsMigration, parseSnapshotInfo } from './ink/history-queries.ts';

test('parseSnapshotInfo: 정기·급감 행을 읽고 잘못된 행은 버린다', () => {
  const base = { id: 7, monitor: '2', reason: 'drop', stroke_count: 10, point_count: 100, prev_point_count: 100, new_point_count: 60, strokes_saved_at: '2026-11-18T00:00:00Z', captured_at: '2026-11-18T00:10:00Z', summary_version: 2 };
  assert.deepEqual(parseSnapshotInfo(base), { id: 7, monitor: '2', reason: 'drop', strokeCount: 10, pointCount: 100, prevPointCount: 100, newPointCount: 60, strokesSavedAt: '2026-11-18T00:00:00Z', capturedAt: '2026-11-18T00:10:00Z', summaryVersion: 2 });
  const old = parseSnapshotInfo({ ...base, reason: 'interval', prev_point_count: null, new_point_count: null, summary_version: undefined });
  assert.ok(old);
  assert.equal(old.prevPointCount, null);
  assert.equal(old.summaryVersion, 1); // 값이 없으면 옛 형식
  assert.equal(parseSnapshotInfo({ ...base, reason: 'x' }), null);
  assert.equal(parseSnapshotInfo({ ...base, id: 'a' }), null);
  assert.equal(parseSnapshotInfo({ ...base, captured_at: 3 }), null);
  assert.equal(parseSnapshotInfo({ ...base, monitor: undefined }), null);
  assert.equal(parseSnapshotInfo(null), null);
});

test('needsMigration: 이력 테이블·열이 없을 때만 안내한다', () => {
  assert.equal(needsMigration('column board_ink_history.summary_version does not exist'), true);
  assert.equal(needsMigration('Could not find the table public.board_ink_history in the schema cache'), true);
  assert.equal(needsMigration('column prev_point_count does not exist'), true);
  assert.equal(needsMigration('permission denied for table board_ink_history'), false);
  assert.equal(needsMigration('fetch failed'), false);
  assert.equal(needsMigration('relation "other_table" does not exist'), false);
});

import { buildTimePoints, groupSnapshotsAt, groupsAt, snapshotAt } from './ink/history-timeline.ts';
import type { SnapshotInfo } from './ink/history-queries.ts';

const snap = (id: number, monitor: string, at: string, reason: 'interval' | 'drop' = 'interval', extra: Partial<SnapshotInfo> = {}): SnapshotInfo => ({
  id, monitor, reason, strokeCount: 1, pointCount: 10, prevPointCount: null, newPointCount: null, strokesSavedAt: at, capturedAt: at, summaryVersion: 2, ...extra,
});
const INFOS = [
  snap(1, '1', '2026-11-18T01:00:05Z'),
  snap(2, '2', '2026-11-18T01:00:05Z'), // 같은 점검 = 같은 시각
  snap(3, 's1', '2026-11-18T01:30:10Z'), // 이 화면은 01:30에야 처음 생김
  snap(4, '1', '2026-11-18T01:30:10Z'),
  snap(5, '1', '2026-11-18T01:42:30Z', 'drop', { prevPointCount: 100, newPointCount: 20 }),
];

test('buildTimePoints: 분 단위로 묶고 최신순, 묶음(버스·별도)과 급감을 알린다', () => {
  const points = buildTimePoints(INFOS);
  assert.deepEqual(points.map((p) => p.groups), [['bus'], ['bus', 'sep'], ['bus']]);
  assert.equal(points[0].key, Date.parse('2026-11-18T01:42:00Z'));
  assert.equal(points[0].endMs, Date.parse('2026-11-18T01:42:59.999Z'));
  assert.deepEqual(points[0].dropGroups, ['bus']);
  assert.deepEqual(points[1].dropGroups, []);
  assert.deepEqual(buildTimePoints([snap(6, 's2', '2026-11-18T02:00:10Z', 'drop')])[0].dropGroups, ['sep']);
  assert.deepEqual(buildTimePoints([]), []);
  assert.deepEqual(buildTimePoints([snap(9, '1', '이상한 값')]), []);
});

test('groupsAt: 그 시각까지 기록이 있던 묶음만, 버스·별도 순', () => {
  assert.deepEqual(groupsAt(INFOS, Date.parse('2026-11-18T01:00:59Z')), ['bus']); // 별도 주문은 아직 없었다
  assert.deepEqual(groupsAt(INFOS, Date.parse('2026-11-18T01:30:59Z')), ['bus', 'sep']);
  assert.deepEqual(groupsAt(INFOS, Date.parse('2026-11-18T00:59:00Z')), []);
});

test('groupSnapshotsAt: 묶음 안 각 모니터의 그 시각 화면(모니터 1·2 순), 기록 없는 모니터는 빠진다', () => {
  const ids = (g: 'bus' | 'sep', at: string) => groupSnapshotsAt(INFOS, g, Date.parse(at)).map((i) => i.id);
  assert.deepEqual(ids('bus', '2026-11-18T01:30:59Z'), [4, 2]); // 모니터 1은 01:30 기록, 모니터 2는 그 전 기록
  assert.deepEqual(ids('bus', '2026-11-18T01:59:59Z'), [5, 2]);
  assert.deepEqual(ids('bus', '2026-11-18T01:00:59Z'), [1, 2]);
  assert.deepEqual(ids('sep', '2026-11-18T01:00:59Z'), []); // 별도 주문은 아직 기록이 없다
  assert.deepEqual(ids('sep', '2026-11-18T01:59:59Z'), [3]); // 별도 2는 기록이 없어 별도 1만
});

test('snapshotAt: 그 시각까지 가장 최근 스냅샷, 같은 순간이면 id가 큰 것', () => {
  assert.equal(snapshotAt(INFOS, '1', Date.parse('2026-11-18T01:30:59Z'))?.id, 4);
  assert.equal(snapshotAt(INFOS, '1', Date.parse('2026-11-18T01:59:59Z'))?.id, 5);
  assert.equal(snapshotAt(INFOS, '2', Date.parse('2026-11-18T01:59:59Z'))?.id, 2); // 2번 화면은 그 뒤 기록이 없어 직전 기록
  assert.equal(snapshotAt(INFOS, 's1', Date.parse('2026-11-18T01:00:59Z')), null);
  assert.equal(snapshotAt([snap(1, '1', '2026-11-18T01:00:05Z'), snap(2, '1', '2026-11-18T01:00:05Z')], '1', Date.parse('2026-11-18T01:30:00Z'))?.id, 2);
});

import { kstTime } from './ink/history-view.ts';
test('kstTime: 밀리초를 한국 시간 HH:mm으로', () => {
  assert.equal(kstTime(Date.parse('2026-11-17T20:06:41Z')), '05:06');
  assert.equal(kstTime(Date.parse('2026-11-18T00:20:00Z')), '09:20');
  assert.equal(kstTime(Number.NaN), '');
});
