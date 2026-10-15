// 주문·박스 기록을 편집할 수 있는 날짜 규칙. 미래 날짜는 항상 막고, 오늘 이전은 설정(allowPastOrderEdit)이 켜져 있을 때만 허용한다.
export function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// 편집할 수 없는 날짜면 사유를, 가능하면 null을 돌려준다.
export function editableDateError(date: string, allowPast: boolean): string | null {
  const today = todayKST();
  if (date > today) return '미래 날짜는 입력할 수 없습니다.';
  if (date < today && !allowPast) return '과거 날짜는 설정에서 "과거 날짜 편집"을 켜야 수정할 수 있습니다.';
  return null;
}
