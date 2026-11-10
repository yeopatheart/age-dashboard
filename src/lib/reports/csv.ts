// CSV 만들기(순수 함수). 엑셀에서 한글이 깨지지 않게 내려받을 때 앞에 BOM을 붙이는 일은 내려받는 쪽이 한다.

// 셀 하나. 수식으로 해석되는 글자(= + - @ 탭 줄바꿈)로 시작하는 문자열은 앞에 '를 붙여 엑셀이 수식으로 실행하지 않게 한다(고객명 등 사용자 입력이 섞여 있다).
export function csvCell(value: string | number | null): string {
  if (value === null) return '""';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((cols) => cols.map((c) => csvCell(c)).join(',')).join('\n');
}
