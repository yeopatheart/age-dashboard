// mockData.ts를 대체한다. 타입과 순수 집계 함수(getProductSummary/getTerminalBoxTotals)는
// 스키마와 무관하게 그대로 재사용하고, 실데이터 조회(Supabase 조인)는 각 화면(server component)에서 한다.

export type ChangeStatus = 'new' | 'modified' | 'cancelled' | 'none';

// 매트릭스의 한 행 = 오늘자 업체 카드(daily_business) 하나. 상품이 아직 하나도 없어도
// (예: "새 주문 추가" 직후) 행 자체는 존재해야 하므로 OrderItem과 별도 타입으로 둔다.
export interface OrderRow {
  dailyBusinessId: string;
  businessId: string;
  businessName: string;
  terminal: string;
  businessNumber: number;
  totalBoxes: number;
  // 주문 입력의 "#메모" — 포장 담당에게 전하는 자유 메모
  memo: string | null;
}

export interface OrderItem {
  id: string;
  dailyBusinessId: string;
  businessId: string;
  businessName: string;
  terminal: string;
  // "업체번호-상품순서" 코드 (docs/decisions/2026-09-29-order-dashboard-architecture.md 결정 3)
  businessNumber: number;
  productSequence: number;
  productId: string | null;
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg?: number;
  sizeRequest?: string;
  isMulbong: boolean;
  // 아크릴 카드 OCR로 반영되는 실측값. 중량 또는 사이즈 등급을 함께 담을 수 있어 자유텍스트다.
  measuredValue?: string;
  isPacked: boolean;
  packedAt?: string;
  // 미출고 수량(0이면 정상) — 주문취소와 별개로, 주문은 유효하지만 현장에서 출고하지 못한 수량.
  unshippedQuantity: number;
  unshippedReason?: string;
  changeStatus: ChangeStatus;
  boxResult?: string;
  // Figma 매트릭스의 "박스" 열 — 업체(daily_business) 단위 값이라 그 업체의 모든 줄에 동일하게 실린다.
  totalBoxes: number;
}

export interface ProductSummaryRow {
  key: string;
  productName: string;
  size: string; // 사이즈/종류 요청(예: "선별", "6-800"). 없으면 빈 문자열
  label: string; // 화면 표시용: "보리새우 (선별)"
  total: number; // 출고 대상 수량 = 주문 − 미출고
  unshipped: number; // 미출고 수량(출고하지 못한 것)
  unit: string;
  mulbong: number;
  packed: number;
}

// 같은 품목이라도 사이즈·종류(선별/일반, 하모 6-800 등)와 단위(미/kg)가 다르면 따로 센다 — 한 줄로 합치면
// 어떤 크기를 얼마나 준비해야 하는지 알 수 없고, 마릿수와 kg가 한 숫자로 더해지는 문제도 있다.
// 정렬은 같은 품목의 줄이 붙어 있도록 품목 합계가 큰 순서로 묶고, 그 안에서는 수량 순이다.
// 주문 입력에서 수량을 못 찾아 "수량 미정"으로 올린 상품(수량 0, 단위 없음). 합계·포장에서는 빠지고 대시보드에 "수량 미정"으로 보인다.
export const isUndecidedQuantity = (item: Pick<OrderItem, 'quantity' | 'unit'>) => item.quantity === 0 && !item.unit;

export function getProductSummary(items: OrderItem[]): ProductSummaryRow[] {
  const map = new Map<string, ProductSummaryRow>();
  for (const item of items) {
    if (item.changeStatus === 'cancelled' || isUndecidedQuantity(item)) continue;
    const size = (item.sizeRequest ?? '').trim();
    const key = `${item.productId ?? item.productName}|${size}|${item.unit}`;
    const existing = map.get(key);
    const shippable = Math.max(0, item.quantity - item.unshippedQuantity);
    if (existing) {
      existing.total += shippable;
      existing.unshipped += item.unshippedQuantity;
      if (item.isMulbong) existing.mulbong += item.quantity;
      if (item.isPacked) existing.packed += item.quantity;
    } else {
      map.set(key, {
        key,
        productName: item.productName,
        size,
        label: size ? `${item.productName} (${size})` : item.productName,
        total: shippable,
        unshipped: item.unshippedQuantity,
        unit: item.unit,
        mulbong: item.isMulbong ? item.quantity : 0,
        packed: item.isPacked ? item.quantity : 0,
      });
    }
  }
  const rows = Array.from(map.values());
  const productTotal = new Map<string, number>();
  for (const r of rows) productTotal.set(r.productName, (productTotal.get(r.productName) ?? 0) + r.total);
  return rows.sort(
    (a, b) =>
      (productTotal.get(b.productName) ?? 0) - (productTotal.get(a.productName) ?? 0) ||
      a.productName.localeCompare(b.productName, 'ko') ||
      b.total - a.total,
  );
}

// rows(daily_business) 기준으로 집계한다 — 상품이 하나도 없는 업체도 박스 수는 갖고 있으므로
// items가 아니라 rows에서 집계해야 빠지지 않는다.
export function getTerminalBoxTotals(rows: OrderRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.terminal, (totals.get(row.terminal) ?? 0) + row.totalBoxes);
  }
  return Array.from(totals.entries()).map(([terminal, boxes]) => ({ terminal, boxes }));
}
