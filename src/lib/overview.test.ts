import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxStatesOf, stageDetail, stageOf, stageOfCard, type BoxState } from './overview.ts';

const item = (over: Partial<Parameters<typeof stageOfCard>[0]['items'][number]> = {}) => ({ changeStatus: 'none' as const, isPacked: false, quantity: 2, unit: '미', unshippedQuantity: 0, ...over });
const states = (...s: BoxState[]): BoxState[] => s;

test('정상 흐름: 박스 할당 → 라벨 → 포장 → 상차 대기 → 상차 중 → 출고 완료', () => {
  assert.equal(stageOf(null, [], false), 'boxing');
  assert.equal(stageOf(2, states('none', 'none'), false), 'labeling');
  assert.equal(stageOf(2, states('printed', 'none'), true), 'labeling');
  assert.equal(stageOf(2, states('printed', 'printed'), false), 'packing');
  assert.equal(stageOf(2, states('printed', 'printed'), true), 'packed');
  assert.equal(stageOf(2, states('loaded', 'printed'), true), 'loading');
  assert.equal(stageOf(2, states('loaded', 'loaded'), true), 'done');
});

test('포장 체크를 안 했어도 상차 스캔이 있으면 상차 기준으로 본다', () => {
  assert.equal(stageOf(2, states('loaded', 'printed'), false), 'loading');
  assert.equal(stageOf(2, states('loaded', 'loaded'), false), 'done');
  assert.equal(stageOf(1, states('loaded'), false), 'done');
});

test('택배는 포장이 끝나면 완료이고 상차 스캔과 무관하다', () => {
  assert.equal(stageOf(1, [], false, true), 'packing');
  assert.equal(stageOf(1, [], true, true), 'done');
});

test('stageOfCard: 상차까지 끝났고 포장 체크가 없는 카드는 출고 완료다', () => {
  const card = stageOfCard({
    items: [item(), item({ isPacked: true })],
    submittedBoxes: 2,
    labels: [
      { seq: 1, loaded: true },
      { seq: 2, loaded: true },
    ],
    parcel: false,
  });
  assert.equal(card.packed, false);
  assert.equal(card.stage, 'done');
});

test('상차까지 갔는데 포장 체크가 빠진 줄이 있으면 설명에 보인다', () => {
  const detail = (stage: 'loading' | 'done', itemsDone: number, itemsLive: number) =>
    stageDetail(stage, { parcel: false, boxStates: boxStatesOf(2, [{ seq: 1, loaded: true }, { seq: 2, loaded: stage === 'done' }]), itemsDone, itemsLive });
  assert.equal(detail('loading', 1, 3), '상차 1/2박스 · 포장 체크 1/3줄');
  assert.equal(detail('done', 0, 2), '2박스 모두 상차 · 포장 체크 0/2줄');
  assert.equal(detail('done', 2, 2), '2박스 모두 상차');
  assert.equal(detail('loading', 3, 3), '상차 1/2박스');
});
