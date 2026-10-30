import type { MergeGroups } from '@/lib/box-merge';
import type { BoxState } from '@/lib/overview';

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
  businessName: string; // 그날 카드에 보이는 이름(display_name이 있으면 그것, 없으면 고객사 이름)
  defaultName: string; // 고객사 관리의 이름
  terminal: string;
  businessNumber: number;
  round: OrderRound;
  // 박스 할당에서 제출한 박스 수. 아직 박스를 할당하지 않았으면 null (대시보드에서는 고칠 수 없다)
  totalBoxes: number | null;
  // 주문 입력의 "#메모" — 포장 담당에게 전하는 자유 메모
  memo: string | null;
  // 박스 구성을 정한 뒤 주문이 바뀌어 박스를 다시 확인해야 한다 (박스 기록의 추천·제출 기준)
  packingChanged?: boolean;
  // 합포장 묶음(포장 뒤 함께 테이핑하는 박스 번호들). 없으면 빈 배열
  mergeGroups: MergeGroups;
  // 택배 터미널(택배사 송장을 붙인다): 박스 라벨을 출력·스캔하지 않는다
  parcel: boolean;
  // 박스 번호별 라벨 상태(미출력·출력·상차). 박스 수를 모르면 빈 배열
  boxStates: BoxState[];
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
  // 박스 할당에서 입력한 실측 중량(kg). 정산용 엑셀의 세부내역에 쓴다.
  measuredWeightKg?: number;
  sizeRequest?: string;
  isMulbong: boolean;
  // 기포기(물봉에 기포기를 부착해서 나간다). true면 isMulbong도 true다.
  hasAerator: boolean;
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
  label: string; // 화면 표시용: "보리새우 (선별)", 물봉·기포기면 "보리새우 (선별) · 기포기"
  prep: Prep;
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

// 준비 방식: 일반 / 물봉(물봉 안에 상품을 담는다) / 기포기(물봉 + 기포기를 부착해서 나간다).
// 같은 상품도 준비 방식이 다르면 별개 줄·별개 합계다.
export type Prep = 'none' | 'mulbong' | 'aerator';
export const PREP_LABEL: Record<Exclude<Prep, 'none'>, string> = { mulbong: '물봉', aerator: '기포기' };
const PREP_ORDER: Prep[] = ['none', 'mulbong', 'aerator'];
export const prepOf = (item: { isMulbong: boolean; hasAerator: boolean }): Prep => (item.hasAerator ? 'aerator' : item.isMulbong ? 'mulbong' : 'none');
export const prepLabelOf = (item: { isMulbong: boolean; hasAerator: boolean }): string | null => {
  const prep = prepOf(item);
  return prep === 'none' ? null : PREP_LABEL[prep];
};

// 같은 품목으로 묶는 기준: 상품(없으면 입력한 이름) + 사이즈·종류 + 단위
export const productKeyOf = (item: Pick<OrderItem, 'productId' | 'productName' | 'sizeRequest' | 'unit' | 'isMulbong' | 'hasAerator'>) =>
  `${item.productId ?? item.productName}|${(item.sizeRequest ?? '').trim()}|${item.unit}|${prepOf(item)}`;

export interface ProductCustomer {
  dailyBusinessId: string;
  name: string;
  quantity: number; // 발송할 수량(미출고 제외)
  unshipped: number;
  allPacked: boolean;
  undecided: boolean; // 같은 품목이지만 수량을 아직 못 정한 줄이 있다
}

// 한 품목(getProductSummary의 한 줄)을 받는 업체와 업체별 수량. 업체는 rowOrder(화면 순서)대로 나열한다.
export function getProductCustomers(items: OrderItem[], product: Pick<ProductSummaryRow, 'key'>, rowOrder: Map<string, number>): ProductCustomer[] {
  // 키는 "상품|사이즈|단위|준비 방식"이다. 수량 미정 줄은 단위가 없어 키가 달라지므로 상품·사이즈·준비 방식까지만 맞춰 본다.
  const parts = product.key.split('|');
  const prep = parts.pop();
  parts.pop();
  const base = parts.join('|');
  const byRow = new Map<string, ProductCustomer>();
  for (const item of items) {
    if (item.changeStatus === 'cancelled') continue;
    const undecided = isUndecidedQuantity(item);
    if (undecided ? !(productKeyOf(item).startsWith(`${base}|`) && prepOf(item) === prep) : productKeyOf(item) !== product.key) continue;
    const entry = byRow.get(item.dailyBusinessId) ?? { dailyBusinessId: item.dailyBusinessId, name: item.businessName, quantity: 0, unshipped: 0, allPacked: true, undecided: false };
    if (undecided) entry.undecided = true;
    else {
      entry.quantity += Math.max(0, item.quantity - item.unshippedQuantity);
      entry.unshipped += item.unshippedQuantity;
      if (!item.isPacked) entry.allPacked = false;
    }
    byRow.set(item.dailyBusinessId, entry);
  }
  return [...byRow.values()].sort((a, b) => (rowOrder.get(a.dailyBusinessId) ?? 999) - (rowOrder.get(b.dailyBusinessId) ?? 999));
}

export function getProductSummary(items: OrderItem[]): ProductSummaryRow[] {
  const map = new Map<string, ProductSummaryRow>();
  for (const item of items) {
    if (item.changeStatus === 'cancelled' || isUndecidedQuantity(item)) continue;
    const size = (item.sizeRequest ?? '').trim();
    const key = productKeyOf(item);
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
        label: `${size ? `${item.productName} (${size})` : item.productName}${prepLabelOf(item) ? ` · ${prepLabelOf(item)}` : ''}`,
        prep: prepOf(item),
        total: shippable,
        unshipped: item.unshippedQuantity,
        unit: item.unit,
        mulbong: item.isMulbong ? item.quantity : 0,
        packed: item.isPacked ? item.quantity : 0,
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.productName.localeCompare(b.productName, 'ko') || a.size.localeCompare(b.size, 'ko') || a.unit.localeCompare(b.unit, 'ko') || PREP_ORDER.indexOf(a.prep) - PREP_ORDER.indexOf(b.prep),
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
