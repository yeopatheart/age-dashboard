// 상품 칸에 붙은 스티커가 칸 안에 안 들어갈 때 갈 수 있는 자리(순수 함수). 결정: docs/decisions/2026-11-22-stickers.md
//
// 순서는 정해져 있다(사용자 확정 2026-11-22):
//   1. 칸 안(inline): 글자를 바닥까지 줄여서 글자 흐름 끝에 끼워 넣는다. 이 파일은 다루지 않는다(화면의 글자 맞춤 효과가 정한다).
//   2. side: 이 칸의 오른쪽 빈 칸에 왼쪽 정렬. 그 줄의 마지막 상품이고, 오른쪽에 새 열을 만들지 않고도 빈 칸이 있고, 업체 메모가 없을 때만.
//   3. below → above: 아래 줄의 같은 열 칸이 비어 있으면 그 칸에, 아니면 위 줄의 칸에, 자기 칸에 2px 걸치게.
//   4. overlay: 모두 안 되면 칸 오른쪽에 반투명하게 얹는다(언제나 가능).
// 위치는 저장하지 않는다. 이웃 칸 상태가 바뀌면 다음 그리기에서 자동으로 다음 순서로 넘어간다.
// 업체 메모는 상품이 끝난 뒤 남는 빈 칸을 모두 차지하므로(주문 목록 규칙) 메모가 있는 줄의 빈 칸은 비어 있지 않은 것으로 본다.

export type Alternative = 'side' | 'below' | 'above' | 'overlay';

export interface NeighborRow {
  itemCount: number; // 그 줄의 상품 수(왼쪽부터 채워진다)
  hasMemo: boolean;
}

export interface PlacementInput {
  slotIndex: number; // 이 칸의 열 번호(0부터)
  ownItemCount: number;
  ownHasMemo: boolean;
  slotCount: number; // 화면의 상품 열 수
  above: NeighborRow | null; // 같은 화면에서 바로 위 줄(없으면 null: 첫 줄이거나 빈 줄)
  below: NeighborRow | null;
}

const emptyAt = (row: NeighborRow | null, slotIndex: number) => row !== null && !row.hasMemo && row.itemCount <= slotIndex;

// 안 들어갈 때 시도할 자리를 우선순위 순서로 돌려준다(overlay는 언제나 마지막에 있다).
export function alternativesFor(input: PlacementInput): Alternative[] {
  const list: Alternative[] = [];
  if (!input.ownHasMemo && input.slotIndex === input.ownItemCount - 1 && input.slotIndex + 1 < input.slotCount) list.push('side');
  if (emptyAt(input.below, input.slotIndex)) list.push('below');
  if (emptyAt(input.above, input.slotIndex)) list.push('above');
  list.push('overlay');
  return list;
}

// 화면 속성(data-stk-alt)에 싣는 문자열 형식.
export const encodeAlternatives = (alternatives: Alternative[]): string => alternatives.join(',');
export function decodeAlternatives(raw: string | undefined): Alternative[] {
  const valid: Alternative[] = ['side', 'below', 'above', 'overlay'];
  const list = (raw ?? '').split(',').filter((k): k is Alternative => (valid as string[]).includes(k));
  return list.length > 0 ? list : ['overlay'];
}
