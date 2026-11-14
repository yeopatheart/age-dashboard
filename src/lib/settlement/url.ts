// 정산 화면의 주소. 정산은 하루(출고일) 단위다(?d=YYYY-MM-DD). 판매내역·배송비·매입내역은 한 화면(/settlement)이고, 영수증은 보내기 화면(/dispatch) 고객사 탭이다.
export const settlementUrl = (d: string) => `/settlement?d=${d}`;

const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 정산 화면의 날짜 읽기: ?d=YYYY-MM-DD(기본 오늘, 미래·잘못된 값은 오늘로 본다).
export function parseSettlementDate(d: string | undefined, today: string): string {
  return d && isValidDate(d) && d <= today ? d : today;
}
