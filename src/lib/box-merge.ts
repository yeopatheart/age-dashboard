// 합포장 묶음: 한 고객 카드 안의 박스 순번 묶음(예: [[1,2],[4,5]]). 순수 함수라 서버·클라이언트가 같이 쓴다.
// 포장이 끝난 뒤 묶음의 박스들을 함께 테이핑하고, 라벨 하나만 스캔해도 묶인 박스가 모두 상차 처리된다.
export type MergeGroups = number[][];

// DB(jsonb)나 화면 입력을 안전한 묶음으로 바꾼다: 1..99 정수만, 묶음 안 중복 제거·정렬, 다른 묶음과 겹치는 순번은 앞 묶음이 가진다,
// 2개 미만이 된 묶음은 버린다. maxBox를 주면 그 번호를 넘는 박스(줄여서 없어진 박스)는 뺀다.
export function normalizeMergeGroups(raw: unknown, maxBox = 99): MergeGroups {
  if (!Array.isArray(raw)) return [];
  const used = new Set<number>();
  const out: MergeGroups = [];
  for (const group of raw) {
    if (!Array.isArray(group)) continue;
    const seqs = [...new Set(group.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= Math.min(99, maxBox) && !used.has(n)))].sort((a, b) => a - b);
    if (seqs.length < 2) continue;
    seqs.forEach((n) => used.add(n));
    out.push(seqs);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export const mergeGroupOf = (groups: MergeGroups, seq: number): number[] | null => groups.find((g) => g.includes(seq)) ?? null;

// 라벨에 찍는 합포장 표시(합포장이 아니면 빈 글자)
export function mergeLabelText(groups: MergeGroups, seq: number): string {
  const group = mergeGroupOf(groups, seq);
  return group ? `합포장 ${group.join('·')}` : '';
}

// 선택한 박스들을 하나의 묶음으로 만든다(이미 다른 묶음에 있던 박스는 그 묶음에서 빠진다).
export function mergeSelected(groups: MergeGroups, selected: number[]): MergeGroups {
  return normalizeMergeGroups([selected, ...groups.map((g) => g.filter((n) => !selected.includes(n)))]);
}

export const unmergeGroup = (groups: MergeGroups, group: number[]): MergeGroups => groups.filter((g) => g[0] !== group[0]);
