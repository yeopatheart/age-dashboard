// 박스 할당 목록의 라벨 출력 상태: 제출한 박스 1~total번 중 한 번이라도 출력한 박스가 몇 개인지.
// 박스를 줄여서 남은 번호(total보다 큰 순번)의 라벨은 세지 않는다.
export interface LabelPrintStatus {
  printed: number;
  total: number;
}

export function labelPrintStatus(total: number, printedSeqs: Iterable<number>): LabelPrintStatus {
  const limit = Math.min(Math.max(total, 0), 99);
  const printed = new Set<number>();
  for (const seq of printedSeqs) if (Number.isInteger(seq) && seq >= 1 && seq <= limit) printed.add(seq);
  return { printed: printed.size, total: limit };
}

// 아직 한 번도 출력하지 않은 박스 순번(1~total). 일괄 출력이 대상으로 삼는다.
export function unprintedSeqs(total: number, printedSeqs: Iterable<number>): number[] {
  const limit = Math.min(Math.max(total, 0), 99);
  const printed = new Set<number>(printedSeqs);
  return Array.from({ length: limit }, (_, i) => i + 1).filter((seq) => !printed.has(seq));
}
