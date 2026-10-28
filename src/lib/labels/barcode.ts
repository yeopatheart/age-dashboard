// 박스 바코드 번호: YYMMDD(주문일) + 업체번호 3자리 + 박스 순번 2자리 + 확인 숫자 1자리 = 숫자 12자리(Code128).
// 같은 날 업체번호는 겹치지 않고(업체 카드마다 하나씩 발급, 재사용 없음) 순번은 박스마다 다르므로 번호가 겹치지 않는다.
// 확인 숫자는 EAN과 같은 방식(앞 11자리에 1,3을 번갈아 곱한 합)이라 스캔 오류나 잘못 입력한 번호를 걸러낸다.
function checkDigit(first11: string): number {
  let sum = 0;
  for (let i = 0; i < first11.length; i++) sum += Number(first11[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function makeBoxBarcode(orderDate: string, businessNumber: number, seq: number): string {
  const [year, month, day] = orderDate.split('-');
  if (!year || !month || !day) throw new Error(`날짜 형식이 올바르지 않습니다: ${orderDate}`);
  if (!Number.isInteger(businessNumber) || businessNumber < 0 || businessNumber > 999) throw new Error(`업체번호가 3자리를 넘었습니다: ${businessNumber}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 99) throw new Error(`박스 순번은 1~99여야 합니다: ${seq}`);
  const first11 = `${year.slice(2)}${month}${day}${String(businessNumber).padStart(3, '0')}${String(seq).padStart(2, '0')}`;
  return `${first11}${checkDigit(first11)}`;
}

export function isValidBoxBarcode(code: string): boolean {
  return /^\d{12}$/.test(code) && checkDigit(code.slice(0, 11)) === Number(code[11]);
}
