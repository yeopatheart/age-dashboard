// 사업자(우리 쪽 사업자등록) 관련 순수 함수. 사업자등록번호는 숫자 10자리로 저장하고 123-45-67890으로 보여 준다.

// 입력에서 숫자만 뽑아 10자리면 돌려주고, 아니면 null.
export function normalizeRegistrationNo(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

// 저장된 값(숫자 10자리)을 화면용으로. 10자리가 아니면 그대로 둔다.
export function formatRegistrationNo(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
}

// 입력창용: 타자를 치는 동안 숫자만 받고 10자리까지 하이픈을 자동으로 넣는다.
export function formatRegistrationInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}
