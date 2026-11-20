import test from 'node:test';
import assert from 'node:assert/strict';
import { fitInRounds, type PillFitOps } from './pill-fit.ts';

// 팁 하나의 가짜 모델: 단계별 높이(heights[step])가 limit 이하가 되는 첫 단계가 정답이다.
type Pill = { heights: number[]; limit: number };

// 예전 방식(팁마다 맞을 때까지 되풀이): 기준 구현.
function fitOneByOne(pills: Pill[]): number[] {
  return pills.map((p) => {
    let step = 0;
    while (p.heights[step] > p.limit && step < p.heights.length - 1) step += 1;
    return step;
  });
}

// 라운드 방식을 돌리고, 쓰기·읽기 호출 기록을 함께 돌려준다.
function run(pills: Pill[]) {
  const current = new Map<Pill, number>();
  const log: string[] = [];
  let reads = 0;
  const ops: PillFitOps<Pill> = {
    lastStep: (p) => p.heights.length - 1,
    apply: (p, step) => {
      current.set(p, step);
      log.push('w');
    },
    overflowing: (ps) => {
      reads += 1;
      log.push('r');
      return ps.map((p) => p.heights[current.get(p) as number] > p.limit);
    },
  };
  const steps = fitInRounds(pills, ops);
  return { steps, reads, log, current };
}

// 결정적인 난수(테스트 재현용).
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('fitInRounds: 팁마다 따로 맞춘 결과와 같다(줄어드는 팁·그대로인 팁·끝까지 넘치는 팁)', () => {
  const pills: Pill[] = [
    { heights: [20, 18, 15, 12], limit: 16 }, // 2단계에서 맞음
    { heights: [10, 9, 8, 7], limit: 16 }, // 0단계에서 맞음
    { heights: [40, 38, 36, 34], limit: 16 }, // 끝까지 넘침 → 마지막 단계
    { heights: [30], limit: 16 }, // 단계가 하나뿐
  ];
  const { steps } = run(pills);
  assert.deepEqual(steps, fitOneByOne(pills));
  assert.deepEqual(steps, [2, 0, 3, 0]);
});

test('fitInRounds: 무작위 팁 500개에서도 팁마다 따로 맞춘 결과와 같고, 읽기 횟수는 단계 수를 넘지 않는다', () => {
  const rand = rng(20261120);
  const pills: Pill[] = [];
  for (let i = 0; i < 500; i += 1) {
    const stepCount = 1 + Math.floor(rand() * 12);
    pills.push({ heights: Array.from({ length: stepCount }, () => Math.floor(rand() * 40)), limit: 5 + Math.floor(rand() * 25) });
  }
  const { steps, reads } = run(pills);
  assert.deepEqual(steps, fitOneByOne(pills));
  // 높이가 단계마다 줄어들지 않아도(무작위) 라운드 수는 가장 긴 단계 수를 넘지 못한다 = 강제 레이아웃 상한.
  assert.ok(reads <= Math.max(...pills.map((p) => p.heights.length - 1)), `reads=${reads}`);
});

test('fitInRounds: 최종 적용된 단계가 돌려준 단계와 같다(마지막 쓰기가 남는다)', () => {
  const pills: Pill[] = [
    { heights: [20, 12, 8], limit: 12 },
    { heights: [50, 50, 50], limit: 12 },
  ];
  const { steps, current } = run(pills);
  assert.deepEqual(steps, [1, 2]);
  pills.forEach((p, i) => assert.equal(current.get(p), steps[i]));
});

test('fitInRounds: 쓰기는 한꺼번에, 읽기는 라운드당 한 번 — 팁별로 쓰기와 읽기가 번갈아 일어나지 않는다', () => {
  const pills: Pill[] = Array.from({ length: 40 }, (_, i) => ({ heights: [30, 25, 20, 15, 10], limit: 10 + (i % 4) * 5 }));
  const { log, reads } = run(pills);
  const text = log.join('');
  // 읽기('r')는 연속하지 않고, 팁이 40개라 쓰기 묶음('w' 연속) 사이에만 읽기가 한 번씩 낀다.
  assert.ok(!text.includes('rr'));
  assert.ok(text.startsWith('w'.repeat(40) + 'r'));
  assert.ok(reads <= 4, `reads=${reads}`);
});

test('fitInRounds: 팁이 없거나 전부 한 단계뿐이면 읽지 않는다', () => {
  assert.deepEqual(fitInRounds([], { lastStep: () => 0, apply: () => {}, overflowing: () => [] }), []);
  const { steps, reads } = run([{ heights: [99], limit: 1 }, { heights: [99], limit: 1 }]);
  assert.deepEqual(steps, [0, 0]);
  assert.equal(reads, 0);
});
