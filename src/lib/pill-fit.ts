// 주문 목록 팁(칩)의 글자 크기 맞춤을 "라운드" 단위로 처리한다(순수 함수, DOM은 호출하는 쪽이 넘긴다).
//
// 왜: 예전에는 팁 하나씩 "글자 크기 쓰기 → 높이 읽기"를 맞을 때까지 되풀이했다. 쓰기 직후에 읽으면 브라우저가 화면 전체 레이아웃을
// 그 자리에서 다시 계산하므로, 팁 수 × 단계 수만큼 강제 레이아웃이 일어났다. 팁 144개(칩 478개) 화면에서 화면이 처음 열릴 때 4초,
// 폰트가 로드된 뒤 2초씩 멈췄다(2026-11-20 실측, docs/decisions/2026-11-20-pill-fit-rounds.md).
// 라운드 방식: 모든 팁에 같은 단계를 한꺼번에 쓰고, 한 번에 읽고, 아직 넘치는 팁만 다음 단계로 내린다. 강제 레이아웃은 단계 수 이하다.
//
// 팁끼리 서로 높이에 영향을 주지 않는다는 전제(팁은 고정 폭 칸 안에 있고 높이는 maxHeight로 막혀 있다)에서 팁마다 따로 맞춘 결과와 같다.
// 그 전제가 깨지면 pill-fit.test.ts의 비교가 아니라 화면의 [수정 전후 CSS 변수 비교]에서 드러난다.

export type PillFitOps<T> = {
  /** 이 팁이 가질 수 있는 마지막 단계 번호(0부터). */
  lastStep: (pill: T) => number;
  /** 팁에 해당 단계의 글자 크기를 쓴다. 쓰기만 하고 읽지 않는다. */
  apply: (pill: T, step: number) => void;
  /** 주어진 팁들이 지금 넘치는지 한꺼번에 읽는다. 쓰기를 섞지 않고, 결과 순서는 입력과 같다. */
  overflowing: (pills: T[]) => boolean[];
};

/** 모든 팁을 0단계에서 시작해 넘치지 않는 첫 단계(없으면 마지막 단계)까지 내린다. 팁마다 정해진 단계 번호를 입력 순서대로 돌려준다. */
export function fitInRounds<T>(pills: T[], ops: PillFitOps<T>): number[] {
  const steps = pills.map(() => 0);
  for (const pill of pills) ops.apply(pill, 0);
  // 마지막 단계에 있는 팁은 더 내릴 수 없으니 읽지 않는다.
  let active = pills.map((_, i) => i).filter((i) => steps[i] < ops.lastStep(pills[i]));
  while (active.length > 0) {
    const flags = ops.overflowing(active.map((i) => pills[i]));
    const next: number[] = [];
    active.forEach((i, k) => {
      if (!flags[k]) return;
      steps[i] += 1;
      ops.apply(pills[i], steps[i]);
      if (steps[i] < ops.lastStep(pills[i])) next.push(i);
    });
    active = next;
  }
  return steps;
}
