// 서버 액션 입력 검증용 작은 헬퍼. 통과하면 null, 아니면 사용자에게 보여줄 사유를 돌려준다.

// YYYY-MM-DD 형식이면서 실제로 존재하는 날짜인지 확인한다(2026-02-31 같은 값을 거른다).
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// 공백만 있거나 너무 긴 이름을 거른다.
export function textError(value: string, label: string, max: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label}을(를) 입력해주세요.`;
  if (trimmed.length > max) return `${label}은(는) ${max}자까지 입력할 수 있습니다.`;
  return null;
}

// 0보다 큰 유한한 수(수량 등).
export function positiveNumberError(value: number, label: string, max = 1_000_000): string | null {
  if (!Number.isFinite(value) || value <= 0) return `${label}은(는) 0보다 커야 합니다.`;
  if (value > max) return `${label}이(가) 너무 큽니다.`;
  return null;
}

// 0 이상의 유한한 수(치수, 무게 등).
export function nonNegativeNumberError(value: number, label: string, max = 1_000_000): string | null {
  if (!Number.isFinite(value) || value < 0) return `${label}은(는) 0 이상이어야 합니다.`;
  if (value > max) return `${label}이(가) 너무 큽니다.`;
  return null;
}
