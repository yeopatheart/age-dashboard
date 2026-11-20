import test from 'node:test';
import assert from 'node:assert/strict';
import { BOX_LINK_COLORS, boxLinkInfos, boxLinkSkipIds, linkBlockReason, linkedCounts, linkedPartners, linkPairBlockReason, type BoxLinkRowRef, type LinkCandidate } from './box-link.ts';

const row = (id: string, boxLinkId: string | null = null, businessName = id): BoxLinkRowRef => ({ dailyBusinessId: id, boxLinkId, businessName });
const cand = (over: Partial<LinkCandidate> = {}): LinkCandidate => ({ id: 'a', terminal: '남부', parcel: false, totalBoxes: 1, linked: false, cancelled: false, loaded: false, ...over });

test('boxLinkInfos: 서로 가리키는 쌍만 연결로 보고 목록 순서대로 A, B를 붙인다', () => {
  const rows = [row('r1'), row('r2', 'r5'), row('r3'), row('r4', 'r6'), row('r5', 'r2'), row('r6', 'r4')];
  const infos = boxLinkInfos(rows);
  assert.equal(infos.size, 4);
  assert.equal(infos.get('r2')?.letter, 'A');
  assert.equal(infos.get('r5')?.letter, 'A');
  assert.equal(infos.get('r4')?.letter, 'B');
  assert.equal(infos.get('r6')?.letter, 'B');
  assert.equal(infos.get('r2')?.color, BOX_LINK_COLORS[0]);
  assert.equal(infos.get('r4')?.color, BOX_LINK_COLORS[1]);
  assert.equal(infos.get('r2')?.partnerId, 'r5');
  assert.equal(infos.get('r5')?.partnerName, 'r2');
  assert.equal(infos.has('r1'), false);
});

test('boxLinkInfos: 한쪽만 가리키거나 짝이 목록에 없거나 자기 자신이면 표시하지 않는다', () => {
  assert.equal(boxLinkInfos([row('a', 'b'), row('b')]).size, 0);
  assert.equal(boxLinkInfos([row('a', 'zzz')]).size, 0);
  assert.equal(boxLinkInfos([row('a', 'a')]).size, 0);
  assert.equal(boxLinkInfos([row('a', 'b'), row('b', 'c'), row('c', 'b')]).size, 2); // b↔c만 연결(a는 한쪽만)
});

test('boxLinkInfos: 쌍이 색 개수보다 많으면 색은 돌려 쓰고 글자는 계속 이어진다', () => {
  const rows: BoxLinkRowRef[] = [];
  for (let i = 0; i < BOX_LINK_COLORS.length + 1; i += 1) rows.push(row(`x${i}`, `y${i}`), row(`y${i}`, `x${i}`));
  const infos = boxLinkInfos(rows);
  const last = BOX_LINK_COLORS.length;
  assert.equal(infos.get(`x${last}`)?.letter, String.fromCharCode(65 + last));
  assert.equal(infos.get(`x${last}`)?.color, BOX_LINK_COLORS[0]);
});

test('boxLinkSkipIds: 쌍 가운데 한 카드만 박스 수를 센다(id가 큰 쪽을 건너뛴다)', () => {
  const skip = boxLinkSkipIds([row('a', 'b'), row('b', 'a'), row('c')]);
  assert.deepEqual([...skip], ['b']);
  assert.deepEqual([...boxLinkSkipIds([row('a'), row('b')])], []);
  // 짝이 목록에 없으면(취소돼 빠짐) 그대로 센다
  assert.deepEqual([...boxLinkSkipIds([row('b', 'a')])], []);
});

test('linkBlockReason: 연결할 수 있는 고객과 없는 사유', () => {
  assert.equal(linkBlockReason(cand()), null);
  assert.match(linkBlockReason(cand({ parcel: true })) ?? '', /택배/);
  assert.match(linkBlockReason(cand({ cancelled: true })) ?? '', /취소/);
  assert.match(linkBlockReason(cand({ linked: true })) ?? '', /이미 합포장/);
  assert.match(linkBlockReason(cand({ totalBoxes: 2 })) ?? '', /1개/);
  assert.match(linkBlockReason(cand({ totalBoxes: null })) ?? '', /1개/);
  assert.match(linkBlockReason(cand({ loaded: true })) ?? '', /상차/);
});

test('linkPairBlockReason: 같은 고객·다른 터미널은 막고, 두 번째 고객의 조건을 본다', () => {
  assert.match(linkPairBlockReason(cand({ id: 'a' }), cand({ id: 'a' })) ?? '', /같은 고객/);
  assert.match(linkPairBlockReason(cand({ id: 'a' }), cand({ id: 'b', terminal: '대구' })) ?? '', /터미널/);
  assert.match(linkPairBlockReason(cand({ id: 'a' }), cand({ id: 'b', totalBoxes: 3 })) ?? '', /1개/);
  assert.equal(linkPairBlockReason(cand({ id: 'a' }), cand({ id: 'b' })), null);
});

test('linkedPartners: 서로 가리키고 둘 다 목록에 있는 쌍만 짝으로 본다', () => {
  const cards = [{ id: 'a', linkId: 'b' }, { id: 'b', linkId: 'a' }, { id: 'c', linkId: 'zzz' }, { id: 'd', linkId: 'e' }, { id: 'e', linkId: null }];
  const partners = linkedPartners(cards);
  assert.equal(partners.get('a'), 'b');
  assert.equal(partners.get('b'), 'a');
  assert.equal(partners.has('c'), false);
  assert.equal(partners.has('d'), false);
});

test('linkedCounts: 쌍은 앞 카드가 한 덩이로 맡고 둘 다 상차돼야 상차로 센다', () => {
  const card = (id: string, linkId: string | null, loaded: number, total: number) => ({ id, linkId, loaded, total });
  const counts = linkedCounts([card('a', 'b', 1, 1), card('b', 'a', 1, 1), card('c', null, 0, 2), card('d', 'e', 1, 1), card('e', 'd', 0, 1)]);
  assert.deepEqual(counts.get('a'), { loaded: 1, total: 1 });
  assert.deepEqual(counts.get('b'), { loaded: 0, total: 0 });
  assert.deepEqual(counts.get('c'), { loaded: 0, total: 2 });
  assert.deepEqual(counts.get('d'), { loaded: 0, total: 1 }); // 한쪽만 상차: 쌍은 아직 상차 전
  assert.deepEqual(counts.get('e'), { loaded: 0, total: 0 });
});
