// 정산 줄의 "실제로 쓰는 값" 계산(순수 함수): 줄에서 직접 고친 값이 있으면 그것, 없으면 날짜별 품목 단가표를 따른다.
// 서버(줄 만들기)와 화면(칸을 고치자마자 다시 계산)이 같은 함수를 쓴다. 결정은 docs/decisions/2026-11-14-settlement-sheet.md.

// 날짜별 품목 단가표의 한 행
export interface PriceEntry {
  saleUnitPrice: number | null; // 판매 단가(원/kg)
  supplierId: string | null; // 기본 매입처
  purchaseUnitPrice: number | null; // 매입 단가(원/kg)
}

export const priceKey = (orderDate: string, product: string) => `${orderDate}|${product}`;

// 줄에서 직접 고친 값(null이면 단가표를 따른다)
export interface LineOwn {
  unitPriceOwn: number | null;
  priceOwn: number | null;
  supplierOwn: string | null;
  purchaseUnitOwn: number | null;
  purchaseOwn: number | null;
}

// 실제로 쓰는 값
export interface LineEffective {
  unitPrice: number | null;
  price: number | null;
  supplierId: string | null;
  purchaseUnitPrice: number | null;
  purchasePrice: number | null;
}

const money = (unit: number, quantity: number) => Math.round(unit * quantity);

// 판매 단가 = 줄 단가 ?? 단가표 / 판매가 = 줄 판매가 ?? 단가 × 수량 / 매입처 = 줄 매입처 ?? 단가표 / 매입 단가 = 줄 ?? 단가표 / 매입가 = 줄 매입가 ?? 매입 단가 × 수량.
// 수량은 판매와 매입이 같다(실중량 kg).
export function resolveLine(own: LineOwn, quantity: number, entry: PriceEntry | undefined): LineEffective {
  const unitPrice = own.unitPriceOwn ?? entry?.saleUnitPrice ?? null;
  const purchaseUnitPrice = own.purchaseUnitOwn ?? entry?.purchaseUnitPrice ?? null;
  return {
    unitPrice,
    price: own.priceOwn ?? (unitPrice === null ? null : money(unitPrice, quantity)),
    supplierId: own.supplierOwn ?? entry?.supplierId ?? null,
    purchaseUnitPrice,
    purchasePrice: own.purchaseOwn ?? (purchaseUnitPrice === null ? null : money(purchaseUnitPrice, quantity)),
  };
}

// 직접 적은 총액이 "단가 × 수량" 그대로인지(자동 계산으로 저장된 값인지). 맞으면 단가나 수량을 고칠 때 총액도 다시 계산한다.
export const isAutoAmount = (amount: number | null, unitPrice: number | null, quantity: number): boolean => amount !== null && unitPrice !== null && amount === money(unitPrice, quantity);
export const amountOf = money;
