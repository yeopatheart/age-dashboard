// 판매·수익 리포트의 집계(순수 함수). 숫자의 정의는 정산 매입내역 요약과 같다(settlement/purchases.ts의 totalsOf):
//  - 매출 = 판매내역에 입력한 판매가 합(출고 완료된 주문 줄), 매입 = 매입내역에 입력한 매입가 합
//  - 이익 = 매입가를 입력한 (출고일 × 품목)만의 (판매가 − 매입가) 합. 매입가가 비면 그 품목은 이익에서 뺀다.
//  - 이익률 = 이익 ÷ "매입가를 입력한 품목의 판매가". 전체 판매가를 분모로 쓰면 매입을 덜 입력한 만큼 이익률이 왜곡된다.
//  - 수량은 미/kg/팩/개 단위가 섞여 있어 합치지 않고 단위별로 나눈다.
//  - 업체별은 매출만 낸다: 매입이 (출고일 × 품목) 단위라 고객사별 이익은 계산할 수 없다.
import type { PurchaseRow } from '../settlement/purchases.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { profitOf } from '../settlement/purchases.ts';
import type { SalesRow } from '../settlement/sales.ts';

export interface UnitQty {
  unit: string;
  qty: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const UNIT_ORDER = ['미', 'kg', '키로', '팩', '개'];

function addQty(map: Map<string, number>, unit: string, qty: number) {
  map.set(unit, (map.get(unit) ?? 0) + qty);
}

function unitList(map: Map<string, number>): UnitQty[] {
  return [...map]
    .map(([unit, qty]) => ({ unit, qty: round3(qty) }))
    .sort((a, b) => {
      const ai = UNIT_ORDER.indexOf(a.unit);
      const bi = UNIT_ORDER.indexOf(b.unit);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.unit.localeCompare(b.unit, 'ko');
    });
}

// 판매가를 입력하지 않은 줄 수.
export const unpricedLines = (sales: SalesRow[]): number => sales.filter((s) => s.price === null).length;

// 이익률과 그 분모. 매입가를 입력한 행이 없으면 null.
export function marginOf(rows: PurchaseRow[]): { profit: number; base: number; margin: number | null } {
  let profit = 0;
  let base = 0;
  for (const r of rows) {
    const p = profitOf(r);
    if (p === null) continue;
    profit += p;
    base += r.salesTotal;
  }
  return { profit, base, margin: base > 0 ? profit / base : null };
}

// ─── 품목별 ─────────────────────────────────────────────────────────────────
export interface ProductStat {
  product: string;
  quantities: UnitQty[]; // 판매수량(출고 수량)을 단위별로
  weightKg: number; // 부가중량(kg) 합(수량에 딸린 무게, 없는 줄은 0)
  customers: number; // 판매한 업체 수(1·2차는 한 업체)
  lines: number; // 판매내역 줄 수
  unpricedLines: number; // 판매가를 입력하지 않은 줄 수(매출이 덜 잡힌다)
  sales: number;
  purchase: number;
  profit: number;
  profitBase: number; // 이익을 계산한 품목의 판매가(이익률의 분모)
  margin: number | null;
  missingPurchase: number; // 매입가를 입력하지 않은 (출고일 × 품목) 수(이익에서 빠진다)
}

export function productStats(sales: SalesRow[], purchases: PurchaseRow[]): ProductStat[] {
  const byProduct = new Map<string, ProductStat & { qty: Map<string, number>; who: Set<string> }>();
  const get = (product: string) => {
    let s = byProduct.get(product);
    if (!s) {
      s = { product, quantities: [], weightKg: 0, customers: 0, lines: 0, unpricedLines: 0, sales: 0, purchase: 0, profit: 0, profitBase: 0, margin: null, missingPurchase: 0, qty: new Map(), who: new Set() };
      byProduct.set(product, s);
    }
    return s;
  };
  for (const row of sales) {
    const s = get(row.product);
    s.lines += 1;
    s.weightKg += row.secondaryWeightKg ?? 0;
    s.who.add(baseCustomerName(row.customer));
    addQty(s.qty, row.unit, row.quantity);
    if (row.price === null) s.unpricedLines += 1;
    else s.sales += row.price;
  }
  for (const p of purchases) {
    const s = get(p.product);
    const profit = profitOf(p);
    if (profit === null) {
      if (p.salesCount > 0) s.missingPurchase += 1;
      continue;
    }
    s.purchase += p.price ?? 0;
    s.profit += profit;
    s.profitBase += p.salesTotal;
  }
  return [...byProduct.values()]
    .map(({ qty, who, ...s }) => ({ ...s, quantities: unitList(qty), weightKg: round3(s.weightKg), customers: who.size, margin: s.profitBase > 0 ? s.profit / s.profitBase : null }))
    .sort((a, b) => b.sales - a.sales || a.product.localeCompare(b.product, 'ko'));
}

// ─── 업체별 ─────────────────────────────────────────────────────────────────
export interface CustomerStat {
  customer: string;
  sales: number;
  lines: number;
  unpricedLines: number;
  days: number; // 주문한 날 수
  dailyAvg: number; // 일평균 매출(주문한 날 기준)
  quantities: UnitQty[];
  weightKg: number;
}

// 같은 날 1·2차 주문이 모두 있으면 고객명에 " 1차"/" 2차"가 붙는다. 업체 단위로 보려고 차수 표기를 떼어 합친다.
export const baseCustomerName = (name: string): string => name.replace(/\s[12]차$/, '');

export function customerStats(sales: SalesRow[]): CustomerStat[] {
  const byCustomer = new Map<string, { sales: number; lines: number; unpriced: number; dates: Set<string>; qty: Map<string, number>; weight: number }>();
  for (const row of sales) {
    const name = baseCustomerName(row.customer);
    let s = byCustomer.get(name);
    if (!s) {
      s = { sales: 0, lines: 0, unpriced: 0, dates: new Set(), qty: new Map(), weight: 0 };
      byCustomer.set(name, s);
    }
    s.lines += 1;
    s.weight += row.secondaryWeightKg ?? 0;
    s.dates.add(row.orderDate);
    addQty(s.qty, row.unit, row.quantity);
    if (row.price === null) s.unpriced += 1;
    else s.sales += row.price;
  }
  return [...byCustomer]
    .map(([customer, s]) => ({
      customer,
      sales: s.sales,
      lines: s.lines,
      unpricedLines: s.unpriced,
      days: s.dates.size,
      dailyAvg: s.dates.size === 0 ? 0 : Math.round(s.sales / s.dates.size),
      quantities: unitList(s.qty),
      weightKg: round3(s.weight),
    }))
    .sort((a, b) => b.sales - a.sales || a.customer.localeCompare(b.customer, 'ko'));
}

// ─── 터미널별 ───────────────────────────────────────────────────────────────
export interface TerminalStat {
  terminal: string;
  sales: number;
  lines: number;
  unpricedLines: number;
  customers: number; // 그 터미널로 나간 업체 수(1·2차는 한 업체)
  days: number;
  quantities: UnitQty[];
  weightKg: number;
}

// 터미널(그날 카드의 터미널)별 매출·수량·업체 수. 이익은 낼 수 없다(매입이 터미널 단위가 아니다).
export function terminalStats(sales: SalesRow[]): TerminalStat[] {
  const by = new Map<string, { sales: number; lines: number; unpriced: number; who: Set<string>; dates: Set<string>; qty: Map<string, number>; weight: number }>();
  for (const row of sales) {
    const name = row.terminal || '미지정';
    let s = by.get(name);
    if (!s) {
      s = { sales: 0, lines: 0, unpriced: 0, who: new Set(), dates: new Set(), qty: new Map(), weight: 0 };
      by.set(name, s);
    }
    s.lines += 1;
    s.who.add(baseCustomerName(row.customer));
    s.dates.add(row.orderDate);
    s.weight += row.secondaryWeightKg ?? 0;
    addQty(s.qty, row.unit, row.quantity);
    if (row.price === null) s.unpriced += 1;
    else s.sales += row.price;
  }
  return [...by]
    .map(([terminal, s]) => ({ terminal, sales: s.sales, lines: s.lines, unpricedLines: s.unpriced, customers: s.who.size, days: s.dates.size, quantities: unitList(s.qty), weightKg: round3(s.weight) }))
    .sort((a, b) => b.sales - a.sales || a.terminal.localeCompare(b.terminal, 'ko'));
}

// "3미 · 5.4키로" 형태의 수량 글.
export const quantityText = (quantities: UnitQty[]): string => (quantities.length === 0 ? '-' : quantities.map((q) => `${q.qty.toLocaleString('en-US')}${q.unit}`).join(' · '));

// 부가중량 글("1.3kg"). 0이면 "-".
export const weightText = (kg: number): string => (kg > 0 ? `${kg.toLocaleString('en-US')}kg` : '-');
