// 상차 스캔 화면의 문구를 만드는 순수 함수(단위 테스트용으로 화면 코드에서 분리).

export interface UndoneBox {
  business: string;
  boxNo: number;
  mergedSeqs: number[]; // 합포장으로 함께 처리된 박스 번호(합포장이 아니면 빈 배열)
}

// 상차를 취소한 뒤 보여 줄 문구: 어느 업체의 몇 번 박스인지, 합포장이면 함께 취소된 번호까지 알려 준다.
export function undoneSummary(box: UndoneBox): { title: string; detail: string } {
  const together = box.mergedSeqs.length > 1 ? ` · 합포장 ${box.mergedSeqs.join('·')}번 함께 취소` : '';
  return {
    title: `${box.business} ${box.boxNo}번 상차를 취소했습니다`,
    detail: `${box.mergedSeqs.length > 1 ? '이 박스들은' : '이 박스는'} 다시 상차 전 상태입니다.${together}`,
  };
}
