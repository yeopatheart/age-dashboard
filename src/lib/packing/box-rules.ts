// 박스 할당·라벨 출력의 순수 규칙. 서버(submitPacking, prepareLabelPrint)와 화면이 같은 판단을 쓰도록 한곳에 둔다.
// import가 없어서 단위 테스트(node --test)로 바로 검증할 수 있다.

export interface BoxLike {
  items: readonly unknown[];
}

// 상품이 하나도 없는 첫 박스의 위치(0부터). 없으면 -1.
// 빈 박스는 제출할 수 없다: 라벨이 나가면 상차 때 영원히 안 찍히는 박스가 되어 "n/m박스" 상차가 끝나지 않는다.
export function firstEmptyBoxIndex(boxes: readonly BoxLike[]): number {
  return boxes.findIndex((b) => b.items.length === 0);
}

export function emptyBoxMessage(index: number): string {
  return `${index + 1}번 박스가 비어 있습니다. 상품을 담거나 박스를 지워주세요.`;
}

// 담을 상품이 하나도 없고 수량 미정 상품만 있는 고객사는 빈 박스로 제출할 수 있다(2026-11-23): 박스는 실제로 있고(그 안에 수량 미정 상품이 들어간다)
// 라벨을 붙여야 하는데, 담을 상품이 없다고 제출을 막으면 라벨을 출력할 수 없다. 그 밖에는 빈 박스를 막는다(위 firstEmptyBoxIndex).
export function emptyBoxesAllowed(packableItemCount: number, undecidedItemCount: number): boolean {
  return packableItemCount === 0 && undecidedItemCount > 0;
}

// 박스 추천 학습에는 상품이 하나라도 담긴 기록만 쓴다: 빈 박스 기록은 "상품 0개에 박스 N개"라서 박스 용량 추정을 틀어지게 한다.
export function hasPackedItems(boxes: readonly BoxLike[]): boolean {
  return boxes.some((b) => b.items.length > 0);
}

// 박스를 지우면 뒤 박스의 번호가 앞당겨진다. 이미 출력한(붙여 둔) 라벨이 있는데 제출한 박스 중 마지막이 아닌 박스를 지우면
// 물리 박스의 스티커 번호와 화면 번호가 어긋난다. savedBoxCount = 제출한 박스 수, removeIndex = 지우는 박스의 위치(0부터).
export function removalShiftsPrintedLabels(savedBoxCount: number, removeIndex: number, printedCount: number): boolean {
  return printedCount > 0 && removeIndex >= 0 && removeIndex < savedBoxCount - 1;
}

// 라벨은 제출한 박스에 대해서만 출력한다. 제출 전이거나 제출한 박스 수보다 큰 번호면 이유를 돌려준다(출력 가능하면 null).
export function printableSeqError(savedBoxCount: number, seqs: readonly number[]): string | null {
  if (savedBoxCount <= 0) return '박스 할당을 제출한 뒤에 라벨을 출력할 수 있습니다.';
  const over = [...seqs].filter((s) => s > savedBoxCount).sort((a, b) => a - b);
  if (over.length > 0) return `제출한 박스는 ${savedBoxCount}개입니다. ${over.join('·')}번 박스는 없습니다. 박스 할당을 다시 제출해주세요.`;
  return null;
}
