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

// 입력 글자가 원 단위 정수로 받을 수 없는 모양이면 이유를 돌려준다(괜찮으면 null). parseWon은 숫자가 아닌 글자를 조용히 지우므로
// "1.5"가 15가 되고 "-500"이 500이 되며 12자리 이상은 잘린다. 금액은 저장되면 영수증·정산으로 이어지므로, 입력을 받는 쪽은
// 이 검사를 먼저 하고 오류가 있으면 저장하지 않는다. 콤마·공백·"원"은 허용한다.
export function wonInputError(input: string): string | null {
  if (input.includes('.')) return '금액은 원 단위 정수만 입력할 수 있습니다 (소수점 불가)';
  if (/[-–−]/.test(input)) return '금액은 0 이상이어야 합니다 (음수 불가)';
  if (/[^\d,\s원]/.test(input)) return '금액은 숫자만 입력할 수 있습니다';
  if (input.replace(/\D/g, '').length > MAX_WON_DIGITS) return `금액은 ${MAX_WON_DIGITS}자리까지 입력할 수 있습니다`;
  return null;
}

// 입력창용(오류가 있어도 안전): 오류가 있으면 입력한 글자를 그대로 둬서 사용자가 무엇이 틀렸는지 보게 하고, 없으면 formatWonInput처럼 콤마를 넣는다.
export const formatWonDraft = (input: string): string => (wonInputError(input) === null ? formatWonInput(input) : input);
