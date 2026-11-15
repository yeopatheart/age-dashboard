// 줄 번호가 터미널 이름에 붙어 온 줄("20남부/ 알라프리마/ ...")을 바로잡는다.
// 파서는 번호 뒤에 공백이 있어야 번호로 읽어서(`19 남부/ ...`), 붙여 쓴 번호는 "20남부"라는 새 터미널이 된다(2026-11-15 운영 주문에서 발생:
// 남부 카드가 아닌 "20남부" 카드가 따로 생기고 터미널 목록에 "20남부"가 자동 등록됐다).
// 숫자를 뗀 나머지가 이미 등록된 터미널이고 붙은 이름 자체는 등록돼 있지 않을 때만 번호로 본다 — "5도장" 같은 실제 터미널 이름은 건드리지 않는다.
export function stripGluedOrderNumber<T extends { orderNumberRaw: string | null; terminalName: string }>(line: T, knownTerminals: ReadonlySet<string>): T {
  if (line.orderNumberRaw !== null || knownTerminals.has(line.terminalName)) return line;
  const match = line.terminalName.match(/^(\d+)(\D.*)$/);
  if (!match) return line;
  const rest = match[2].trim();
  if (!knownTerminals.has(rest)) return line;
  return { ...line, orderNumberRaw: match[1], terminalName: rest };
}
