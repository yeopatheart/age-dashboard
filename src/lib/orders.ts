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
  changeStatus: ChangeStatus;
  boxResult?: string;
  // Figma 매트릭스의 "박스" 열 — 업체(daily_business) 단위 값이라 그 업체의 모든 줄에 동일하게 실린다.
  totalBoxes: number;
}

export function getProductSummary(items: OrderItem[]) {
  const map = new Map<string, { productName: string; total: number; mulbong: number; unit: string; packed: number }>();
  for (const item of items) {
    if (item.changeStatus === 'cancelled') continue;
    const key = item.productId ?? item.productName;
    const existing = map.get(key);
    if (existing) {
      existing.total += item.quantity;
      if (item.isMulbong) existing.mulbong += item.quantity;
      if (item.isPacked) existing.packed += item.quantity;
    } else {
      map.set(key, {
        productName: item.productName,
        total: item.quantity,
        mulbong: item.isMulbong ? item.quantity : 0,
        unit: item.unit,
        packed: item.isPacked ? item.quantity : 0,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
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
