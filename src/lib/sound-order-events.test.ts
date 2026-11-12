import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEvent, diffOrders, planCues, spokenEvent, type OrderSnapshot } from './sound/order-events.ts';

type Row = OrderSnapshot['rows'][number];
type Item = OrderSnapshot['items'][number];

const row = (over: Partial<Row> = {}): Row => ({ dailyBusinessId: 'b1', businessName: '청해수산', round: 1, memo: null, terminal: '대구', ...over });
const item = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  dailyBusinessId: 'b1',
  productName: '활감성돔',
  quantity: 2,
  unit: '미',
  secondaryWeightKg: undefined,
  isMulbong: false,
  hasAerator: false,
  sizeRequest: undefined,
  isPacked: false,
  unshippedQuantity: 0,
  changeStatus: 'none',
  ...over,
});
const snap = (rows: Row[], items: Item[]): OrderSnapshot => ({ rows, items });

test('변화가 없으면 이벤트가 없다', () => {
  const s = snap([row()], [item()]);
  assert.deepEqual(diffOrders(s, s), []);
});

test('취소했던 품목을 되살리면 취소 복구 이벤트가 난다', () => {
  const prev = snap([row()], [item({ changeStatus: 'cancelled' })]);
  const next = snap([row()], [item({ changeStatus: 'modified' })]);
  const events = diffOrders(prev, next);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'item-restored');
  assert.equal(describeEvent(events[0]), '취소 복구, 청해수산 활감성돔');
  assert.equal(spokenEvent(events[0]), '취소 복구. 청해수산. 활감성돔');
});

test('품목을 취소하면 취소 이벤트, 포장된 품목이면 긴급 이벤트가 난다', () => {
  const cancelled = snap([row()], [item({ changeStatus: 'cancelled' })]);
  assert.equal(diffOrders(snap([row()], [item()]), cancelled)[0].kind, 'item-cancelled');
  assert.equal(diffOrders(snap([row()], [item({ isPacked: true })]), cancelled)[0].kind, 'packed-item-changed');
});

test('+kg(secondaryWeightKg)만 바뀌어도 수량 변경으로 알린다', () => {
  const prev = snap([row()], [item({ secondaryWeightKg: 3 })]);
  const next = snap([row()], [item({ secondaryWeightKg: 4 })]);
  assert.equal(diffOrders(prev, next)[0].kind, 'qty-changed');
  const packedPrev = snap([row()], [item({ secondaryWeightKg: 3, isPacked: true })]);
  const packedNext = snap([row()], [item({ secondaryWeightKg: 4, isPacked: true })]);
  assert.equal(diffOrders(packedPrev, packedNext)[0].kind, 'packed-item-changed');
});

test('메모·터미널·카드 이름이 바뀌면 업체 정보 수정 이벤트가 난다', () => {
  const base = snap([row()], [item()]);
  for (const changed of [row({ memo: '오전 도착 부탁' }), row({ terminal: '해운대' }), row({ businessName: '청해수산(새이름)' })]) {
    const events = diffOrders(base, snap([changed], [item()]));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'order-modified');
    assert.equal(events[0].business, changed.businessName);
  }
  // 메모가 null → 빈 문자열처럼 같은 뜻이면 알리지 않는다
  assert.deepEqual(diffOrders(snap([row({ memo: null })], [item()]), snap([row({ memo: '' })], [item()])), []);
});

test('새 업체 카드에 딸려 온 품목과 메모는 새 주문 하나로만 알린다', () => {
  const prev = snap([], []);
  const next = snap([row({ memo: '메모' })], [item()]);
  const events = diffOrders(prev, next);
  assert.deepEqual(events.map((e) => e.kind), ['order-new']);
});

test('새 이벤트 종류도 소리 계획에 들어간다', () => {
  const restored = diffOrders(snap([row()], [item({ changeStatus: 'cancelled' })]), snap([row()], [item({ changeStatus: 'modified' })]));
  assert.deepEqual(planCues(restored, 'tone', []).map((c) => c.tone), ['added']);
  const modified = diffOrders(snap([row()], [item()]), snap([row({ memo: 'x' })], [item()]));
  assert.deepEqual(planCues(modified, 'tone', []).map((c) => c.tone), ['changed']);
  // 사용자가 끈 종류는 소리가 나지 않는다
  assert.deepEqual(planCues(restored, 'tone', ['item-restored']), []);
});

test('포장 체크를 풀면 포장 해제 이벤트가 나고 소리·문구가 계획된다', () => {
  const prev = snap([row()], [item({ isPacked: true })]);
  const next = snap([row()], [item({ isPacked: false })]);
  const events = diffOrders(prev, next);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'item-unpacked');
  assert.equal(describeEvent(events[0]), '포장 해제, 청해수산 활감성돔');
  assert.equal(spokenEvent(events[0]), '포장 해제. 청해수산. 활감성돔');
  assert.deepEqual(planCues(events, 'voice', ['item-packed']), [{ tone: 'changed', say: ['포장 해제. 청해수산. 활감성돔'] }]);
});

test('포장 해제는 기본 설정(포장 체크만 끔)에서도 소리가 난다', () => {
  const events = diffOrders(snap([row()], [item({ isPacked: true })]), snap([row()], [item({ isPacked: false })]));
  assert.equal(planCues(events, 'tone', ['item-packed']).length, 1);
});

test('차수가 바뀐 업체 카드는 업체 정보 수정 이벤트가 난다', () => {
  const events = diffOrders(snap([row({ round: 1 })], [item()]), snap([row({ round: 2 })], [item()]));
  assert.deepEqual(events.map((e) => e.kind), ['order-modified']);
});
