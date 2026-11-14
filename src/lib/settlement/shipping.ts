// 정산 배송비(버스·퀵·택배)의 줄 만들기(순수 함수). 줄은 "출고 완료된 고객 카드 × 수단"이고,
// 사용자가 저장한 값은 settlement_shipping에서 붙이고, 저장 전에는 고객사·터미널 설정으로 "제안"한다. 결정은 docs/decisions/2026-11-14-settlement-shipping.md.

export type ShippingMethod = 'bus' | 'quick' | 'parcel';

// 화면·엑셀에서 보이는 순서와 이름.
export const SHIPPING_METHODS: { key: ShippingMethod; label: string }[] = [
  { key: 'bus', label: '버스' },
  { key: 'quick', label: '퀵' },
  { key: 'parcel', label: '택배' },
];

export const shippingLabel = (method: ShippingMethod): string => SHIPPING_METHODS.find((m) => m.key === method)?.label ?? method;

// 엑셀·입력에서 받은 글자를 수단으로 바꾼다(모르는 글자는 null).
export function parseShippingMethod(text: string): ShippingMethod | null {
  const t = text.trim();
  return SHIPPING_METHODS.find((m) => m.label === t || m.key === t.toLowerCase())?.key ?? null;
}

export interface ShippingRates {
  bus: number | null; // 박스당 기본 금액(원). null이면 그 수단을 쓰지 않는 고객사
  quick: number | null;
  parcel: number | null;
}

// 배송비를 붙일 수 있는 카드(출고 완료된 그날 고객 카드) 한 장.
export interface ShippingCard {
  cardId: string;
  orderDate: string;
  customer: string; // 정산 판매내역에 보이는 고객명(차수 표시 포함)
  terminal: string; // 그날 카드의 터미널 이름
  quickAllowed: boolean; // 그 터미널에서 퀵이 되는지(false면 퀵을 제안하지 않는다)
  boxes: number; // 그날 박스 수(제출한 박스 수, 택배는 제출 전이어도 1)
  rates: ShippingRates;
  sellerId: string | null; // 그 고객의 판매 줄 사업자(저장한 배송비 줄에 사업자가 없을 때 따른다)
}

// 사용자가 저장한 배송비 줄
export interface StoredShipping {
  id: string;
  cardId: string;
  method: ShippingMethod;
  boxes: number;
  amount: number;
  sellerId: string | null;
  paid: boolean;
  memo: string | null;
}

export interface ShippingRow {
  key: string; // `${cardId}|${method}` — 화면·엑셀의 행 키
  cardId: string;
  orderDate: string;
  customer: string;
  terminal: string;
  method: ShippingMethod;
  boxes: number;
  rate: number | null; // 그 고객사의 박스당 기본 금액(제안 줄의 박스 수를 고치면 금액을 다시 계산한다). 설정이 없으면 null
  amount: number | null; // 제안 줄은 박스 수 × 기본 금액. 저장한 줄은 저장한 금액
  saved: boolean; // false면 설정으로 제안한 줄(저장하기 전에는 영수증에 들어가지 않는다)
  sellerId: string | null; // 저장한 사업자, 없으면 판매 줄의 사업자
  paid: boolean;
  memo: string;
  quickBlocked: boolean; // 저장돼 있지만 지금 설정으로는 퀵 불가 터미널(안내용)
}

export const shippingKey = (cardId: string, method: ShippingMethod) => `${cardId}|${method}`;

// 제안 금액 = 박스 수 × 박스당 기본 금액
export const suggestAmount = (rate: number, boxes: number): number => Math.round(rate * boxes);

// 카드마다 저장한 줄을 먼저 두고, 설정으로 제안할 수 있는 수단(고객사 금액이 있고 퀵이면 터미널이 퀵 가능)을 아직 저장 안 한 것만 제안으로 붙인다.
// 박스가 0개인 카드는 제안하지 않는다. 정렬: 출고일 → 고객명(가나다) → 수단 순서.
export function buildShippingRows(cards: ShippingCard[], stored: StoredShipping[]): ShippingRow[] {
  const storedByKey = new Map(stored.map((s) => [shippingKey(s.cardId, s.method), s]));
  const rows: ShippingRow[] = [];
  for (const card of cards) {
    for (const { key: method } of SHIPPING_METHODS) {
      const s = storedByKey.get(shippingKey(card.cardId, method));
      if (s) {
        rows.push({
          key: shippingKey(card.cardId, method),
          cardId: card.cardId,
          orderDate: card.orderDate,
          customer: card.customer,
          terminal: card.terminal,
          method,
          boxes: s.boxes,
          rate: card.rates[method],
          amount: s.amount,
          saved: true,
          sellerId: s.sellerId ?? card.sellerId,
          paid: s.paid,
          memo: s.memo ?? '',
          quickBlocked: method === 'quick' && !card.quickAllowed,
        });
        continue;
      }
      const rate = card.rates[method];
      if (rate === null || card.boxes <= 0) continue;
      if (method === 'quick' && !card.quickAllowed) continue;
      rows.push({
        key: shippingKey(card.cardId, method),
        cardId: card.cardId,
        orderDate: card.orderDate,
        customer: card.customer,
        terminal: card.terminal,
        method,
        boxes: card.boxes,
        rate,
        amount: suggestAmount(rate, card.boxes),
        saved: false,
        sellerId: card.sellerId,
        paid: false,
        memo: '',
        quickBlocked: false,
      });
    }
  }
  rows.sort(
    (a, b) =>
      (a.orderDate === b.orderDate ? 0 : a.orderDate < b.orderDate ? -1 : 1) ||
      a.customer.localeCompare(b.customer, 'ko') ||
      SHIPPING_METHODS.findIndex((m) => m.key === a.method) - SHIPPING_METHODS.findIndex((m) => m.key === b.method),
  );
  return rows;
}

export interface ShippingTotals {
  rows: number;
  total: number; // 저장한 줄의 금액 합(제안 줄은 제외)
  suggested: number; // 아직 저장하지 않은 제안 줄 수
  unpaid: number; // 저장한 줄 중 입금 N
}

export function shippingTotals(rows: ShippingRow[]): ShippingTotals {
  let total = 0;
  let suggested = 0;
  let unpaid = 0;
  for (const r of rows) {
    if (!r.saved) {
      suggested++;
      continue;
    }
    total += r.amount ?? 0;
    if (!r.paid) unpaid++;
  }
  return { rows: rows.length, total, suggested, unpaid };
}

// 박스 수가 금액을 나눠떨어질 때만 영수증 단가를 채운다(퀵·택배는 박스 수에 비례하지 않아 비워 둔다).
export function shippingUnitPrice(amount: number, boxes: number): number | null {
  return boxes > 0 && amount % boxes === 0 ? amount / boxes : null;
}

// ── 저장 입력 검증(저장 액션과 엑셀 가져오기가 같이 쓴다) ──────────────────────────────────

export interface ShippingInput {
  cardId: string; // 그날 고객 카드(daily_businesses.id)
  method: string; // bus | quick | parcel
  boxes: number;
  amount: number; // 그 수단의 배송비 총액(원)
  sellerId: string | null;
  paid: boolean;
  memo: string | null;
}

export const MAX_BOXES = 9999; // 0062의 check와 같다
export const MAX_SHIPPING_AMOUNT = 99_999_999_999; // src/lib/money.ts의 MAX_WON_DIGITS(11자리)와 같다
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 문제가 있으면 사유, 없으면 null.
export function shippingInputError(r: ShippingInput): string | null {
  if (!UUID_PATTERN.test(r.cardId) || !parseShippingMethod(r.method)) return '배송비 행이 올바르지 않습니다.';
  if (!Number.isInteger(r.boxes) || r.boxes < 0 || r.boxes > MAX_BOXES) return `박스 수는 0~${MAX_BOXES.toLocaleString('ko-KR')} 사이 정수로 입력해주세요.`;
  if (!Number.isInteger(r.amount) || r.amount < 0 || r.amount > MAX_SHIPPING_AMOUNT) return '배송비 금액이 올바르지 않습니다.';
  if (r.sellerId !== null && !UUID_PATTERN.test(r.sellerId)) return '사업자 구분이 올바르지 않습니다.';
  if ((r.memo ?? '').trim().length > 500) return '메모는 500자 이하로 입력해주세요.';
  return null;
}
