// 주문·박스 기록을 편집할 수 있는 날짜 규칙. 미래 날짜는 기본적으로 막고, 오늘 이전은 설정(allowPastOrderEdit)이 켜져 있을 때만 허용한다.
// 주문 입력·박스 할당·라벨 출력만 내일까지 미리 할 수 있다(2026-11-15: 형이 전날 주문을 미리 입력할 수 있게). 그 밖의 편집(주문 목록·상차 스캔 등)은 오늘만 된다.
export function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// 오늘 다음 날(한국 날짜).
export function tomorrowKST() {
  const d = new Date(`${todayKST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 편집할 수 없는 날짜면 사유를, 가능하면 null을 돌려준다. allowTomorrow: 내일까지 미리 편집할 수 있는 화면(주문 입력·박스 할당)만 true.
export function editableDateError(date: string, allowPast: boolean, options: { allowTomorrow?: boolean } = {}): string | null {
  const today = todayKST();
  if (date > today) {
    if (options.allowTomorrow && date <= tomorrowKST()) return null;
    return options.allowTomorrow ? '내일까지만 미리 입력할 수 있습니다.' : '미래 날짜는 입력할 수 없습니다.';
  }
  if (date < today && !allowPast) return '과거 날짜는 설정에서 "과거 날짜 편집"을 켜야 수정할 수 있습니다.';
  return null;
}
