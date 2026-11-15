// 화면에 보이는 업체 번호(표시용)를 매긴다. 주문 목록 순서대로 일반 주문은 1번부터 빠짐없이 센다.
//
// 발급 번호(daily_businesses.business_number)는 박스 라벨 QR에 들어 있고 하루 안에 유일해야 해서, 카드를 지워도 카운터가 되돌아가지 않는다.
// 그래서 형이 16건을 지우고 다시 입력한 11/16에 주문 목록이 17번부터 시작했다. 이 번호는 "오늘 출고할 고객사가 몇 곳인지" 세는 용도라
// 화면에서는 발급 번호가 아니라 목록 순서의 번호를 보여 준다(2026-11-16, 사용자 결정). 라벨·QR·DB의 번호는 그대로다.
// - 목록 순서(sort_order)대로 센다: 끌어서 순서를 바꾸면 번호도 따라 바뀐다.
// - 상품이 모두 취소된 카드도 목록에 보이는 한 센다(드문 경우라 따로 빼지 않는다).
// - 1·2차는 목록에서 별개 줄이라 각각 센다.
// - 별도 주문(택배·직배송 등)은 일반 주문과 따로 센다. 이 버전에서는 별도 주문을 발급 번호 그대로 보여 준다.
export interface NumberedCard {
  id: string;
  businessNumber: number; // 발급 번호(라벨·QR의 번호)
  separate: boolean; // 별도 주문 터미널의 카드
}

// cards는 주문 목록 순서(sort_order)로 넘긴다. 화면에 보일 번호 글자를 카드 id별로 돌려준다.
export function cardNumberLabels(cards: readonly NumberedCard[]): Map<string, string> {
  const labels = new Map<string, string>();
  let general = 0;
  for (const card of cards) {
    labels.set(card.id, card.separate ? String(card.businessNumber) : String(++general));
  }
  return labels;
}
