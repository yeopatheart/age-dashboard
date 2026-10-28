// mockData.ts를 대체한다. 타입과 순수 집계 함수(getProductSummary/getTerminalBoxTotals)는
// 스키마와 무관하게 그대로 재사용하고, 실데이터 조회(Supabase 조인)는 각 화면(server component)에서 한다.

export type ChangeStatus = 'new' | 'modified' | 'cancelled' | 'none';

// 주문 차수 — 같은 날 같은 고객사도 차수가 다르면 별개 업체 카드(daily_businesses)다.
export type OrderRound = 1 | 2;

// 매트릭스의 한 행 = 오늘자 업체 카드(daily_business) 하나. 상품이 아직 하나도 없어도
// (예: "새 주문 추가" 직후) 행 자체는 존재해야 하므로 OrderItem과 별도 타입으로 둔다.
// 같은 날 1차와 2차에 모두 주문이 있는 고객사의 id. 이 고객사만 업체명 옆에 차수를 붙인다
// (한 차수에만 있으면 구분할 필요가 없어 TV 화면의 업체명 칸을 아낀다).
export function businessIdsInBothRounds(rows: { businessId: string; round: OrderRound }[]): Set<string> {
  const seen = new Map<string, Set<OrderRound>>();
  for (const r of rows) seen.set(r.businessId, (seen.get(r.businessId) ?? new Set()).add(r.round));
  return new Set([...seen].filter(([, rounds]) => rounds.size > 1).map(([id]) => id));
}

export function roundLabel(round: OrderRound): string {
  return `${round}차`;
}

export interface OrderRow {
  dailyBusinessId: string;
  businessId: string;
  businessName: string;
  terminal: string;
  businessNumber: number;
  round: OrderRound;
  // 박스 할당에서 제출한 박스 수. 아직 박스를 할당하지 않았으면 null (대시보드에서는 고칠 수 없다)
  totalBoxes: number | null;
  // 주문 입력의 "#메모" — 포장 담당에게 전하는 자유 메모
  memo: string | null;
  // 박스 구성을 정한 뒤 주문이 바뀌어 박스를 다시 확인해야 한다 (박스 기록의 추천·제출 기준)
  packingChanged?: boolean;
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
  isPacked: boolean;
  // 미출고 수량(0이면 정상) — 주문취소와 별개로, 주문은 유효하지만 현장에서 출고하지 못한 수량.
  unshippedQuantity: number;
  unshippedReason?: string;
  changeStatus: ChangeStatus;
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
// 정렬은 품목명 한글 오름차순 → 사이즈·종류 → 단위 순이다. 합계가 큰 순서로 묶으면 "일산참돔"과 "일산참돔 (작은거)"처럼
// 비슷한 품목이 멀리 떨어져서, 같은 품목을 한눈에 비교할 수 있도록 이름순으로 둔다(사이즈가 없는 줄이 먼저).
// 주문 입력에서 수량을 못 찾아 "수량 미정"으로 올린 상품(수량 0, 단위 없음). 합계·포장에서는 빠지고 대시보드에 "수량 미정"으로 보인다.
export const isUndecidedQuantity = (item: Pick<OrderItem, 'quantity' | 'unit'>) => item.quantity === 0 && !item.unit;

// 업체 카드(행)의 모든 상품이 끝났는지: 취소되지 않은 상품이 하나 이상 있고, 전부 포장 완료이거나 전량 미출고여야 한다.
// 수량 미정인 상품이 하나라도 있으면 아직 끝난 것이 아니다(수량을 채워야 한다).
export function isCardComplete(items: Pick<OrderItem, 'changeStatus' | 'isPacked' | 'quantity' | 'unit' | 'unshippedQuantity'>[]): boolean {
  const live = items.filter((i) => i.changeStatus !== 'cancelled');
  if (live.length === 0) return false;
  return live.every((i) => !isUndecidedQuantity(i) && (i.isPacked || i.quantity - i.unshippedQuantity <= 0));
}

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
  return Array.from(map.values()).sort(
    (a, b) => a.productName.localeCompare(b.productName, 'ko') || a.size.localeCompare(b.size, 'ko') || a.unit.localeCompare(b.unit, 'ko'),
  );
}

// rows(daily_business) 기준으로 집계한다 — 상품이 하나도 없는 업체도 박스 수는 갖고 있으므로
// items가 아니라 rows에서 집계해야 빠지지 않는다.
export function getTerminalBoxTotals(rows: OrderRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.terminal, (totals.get(row.terminal) ?? 0) + (row.totalBoxes ?? 0));
  }
  return Array.from(totals.entries()).map(([terminal, boxes]) => ({ terminal, boxes }));
}
