// 보내기 화면 "고객사" 탭: 정산이 끝난 고객사를 고르고, 업체에 보낼 정산 메시지 글을 만든다(순수 함수).
// 정산 완료 = 그날 그 고객사의 판매내역 줄이 하나 이상이고 모든 줄의 판매가가 입력된 것(사용자 결정 2026-11-10).
import { formatWon } from './money.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { formatQuantity } from './settlement/receipt.ts';

// 판매내역 줄 중 메시지에 필요한 값만(SalesRow의 일부).
export interface MessageRow {
  customer: string;
  product: string;
  quantity: number;
  unit: string;
  price: number | null;
}

export interface SettledCustomer {
  customer: string;
  rows: (MessageRow & { price: number })[];
  total: number;
}

// 줄들을 고객사별로 묶는다(처음 나온 순서 유지). 모든 줄에 판매가가 있는 고객사는 settled, 하나라도 비어 있으면 pending(고객명만).
export function groupSettledCustomers(rows: MessageRow[]): { settled: SettledCustomer[]; pending: string[] } {
  const byCustomer = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const list = byCustomer.get(row.customer);
    if (list) list.push(row);
    else byCustomer.set(row.customer, [row]);
  }
  const settled: SettledCustomer[] = [];
  const pending: string[] = [];
  for (const [customer, list] of byCustomer) {
    if (list.every((r) => r.price !== null)) {
      const complete = list as (MessageRow & { price: number })[];
      settled.push({ customer, rows: complete, total: complete.reduce((sum, r) => sum + r.price, 0) });
    } else {
      pending.push(customer);
    }
  }
  return { settled, pending };
}

// "2026-11-09" → "11/9"(앞의 0을 쓰지 않는다).
export function formatMessageDate(orderDate: string): string {
  const [, m, d] = orderDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 고객사에 보낼 글:
//   감사합니다.
//   11/9 엔야 - 총 302,000
//   1. 활전갱이 3미1.3키로 : 39,000
export function buildCustomerMessage(orderDate: string, c: SettledCustomer): string {
  const lines = c.rows.map((r, i) => `${i + 1}. ${r.product} ${formatQuantity(r.quantity, r.unit)} : ${formatWon(r.price)}`);
  return ['감사합니다.', `${formatMessageDate(orderDate)} ${c.customer} - 총 ${formatWon(c.total)}`, ...lines].join('\n');
}
