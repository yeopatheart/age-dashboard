// 금액(원) 입력·표시 순수 함수. 금액은 정수 원으로만 다룬다(소수 없음).

export const MAX_WON_DIGITS = 11; // 999억 원대까지. DB(bigint)와 JS 안전 정수 범위 안이다

// 입력 글자에서 숫자만 뽑아 정수로 바꾼다. 숫자가 없으면 null.
export function parseWon(input: string): number | null {
  const digits = input.replace(/\D/g, '').slice(0, MAX_WON_DIGITS);
  return digits === '' ? null : Number(digits);
}

// 표시용: 천 단위 콤마(예: 1234567 → "1,234,567"). null이면 빈 글자.
export const formatWon = (value: number | null): string => (value === null ? '' : value.toLocaleString('en-US'));

// 입력창용: 타자를 치는 동안 숫자만 남기고 콤마를 자동으로 넣는다.
export const formatWonInput = (input: string): string => formatWon(parseWon(input));
