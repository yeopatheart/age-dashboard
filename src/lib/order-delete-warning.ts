// 주문 목록의 "주문 삭제" 확인 문구. 삭제하면 박스 기록·라벨·상차 기록이 cascade로 함께 지워지므로(0003 등), 지워질 내용을 숫자로 보여 준다.
export interface OrderDeleteImpact {
  submittedBoxes: number; // 제출한 박스 수
  labels: number; // 발급된 라벨 수
  loadedLabels: number; // 그중 상차 완료된 라벨 수
}

export const ORDER_DELETE_BASE_MESSAGE = '이 날짜의 주문을 완전히 삭제하시겠습니까? 등록된 상품도 모두 함께 삭제됩니다. (고객사 관리의 고객사는 삭제되지 않습니다.)';

// impact가 null이면 기록을 확인하지 못한 것이다: 모를 때는 지워질 수 있다고 알린다.
export function orderDeleteMessage(impact: OrderDeleteImpact | null): string {
  if (impact === null) return `${ORDER_DELETE_BASE_MESSAGE}\n\n⚠ 박스·라벨 기록을 확인하지 못했습니다. 기록이 있다면 함께 지워지고 되돌릴 수 없습니다.`;
  if (impact.submittedBoxes === 0 && impact.labels === 0) return ORDER_DELETE_BASE_MESSAGE;
  const parts: string[] = [];
  if (impact.submittedBoxes > 0) parts.push(`제출한 박스 ${impact.submittedBoxes}개`);
  if (impact.labels > 0) parts.push(`발급된 라벨 ${impact.labels}장${impact.loadedLabels > 0 ? `(상차 완료 ${impact.loadedLabels}장)` : ''}`);
  return `${ORDER_DELETE_BASE_MESSAGE}\n\n⚠ 이 주문에는 ${parts.join(', ')}이(가) 있습니다. 삭제하면 박스 기록·라벨·상차 기록도 함께 지워지고 되돌릴 수 없습니다.${impact.labels > 0 ? " 이미 붙인 스티커는 스캔하면 '출력된 적 없는 번호'로 나옵니다." : ''} 주문만 빼려면 상품을 취소 상태로 바꾸세요.`;
}
