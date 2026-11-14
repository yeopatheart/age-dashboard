// 실시간 신호(order_items 변경)에 담긴 행을 지금 화면의 주문 스냅샷에 바로 반영한다. 서버에서 화면 전체를 다시 받기 전에 변경 소리를 내기 위한 것이다.
// 화면이 만드는 값과 똑같은 모양으로 바꿔야(app/(dashboard)/dashboard/page.tsx의 주문 줄 변환과 같은 규칙) 나중에 서버 데이터가 와도 또 울리지 않는다.
// 스냅샷만으로 알 수 없는 경우(모르는 업체 카드의 줄, 모르는 줄의 수정·삭제)는 null이다 — 그때는 서버 데이터가 오면 기존 비교 경로가 알린다.
import type { ChangeStatus } from '../orders.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import type { OrderSnapshot } from './order-events.ts';

export interface ItemChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

type SnapshotItem = OrderSnapshot['items'][number];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toItem(row: Record<string, unknown>, dailyBusinessId: string): SnapshotItem {
  return {
    id: str(row.id),
    dailyBusinessId,
    productName: str(row.product_name_raw),
    quantity: num(row.quantity),
    unit: str(row.unit),
    secondaryWeightKg: row.secondary_weight_kg == null ? undefined : num(row.secondary_weight_kg),
    sizeRequest: row.size_request == null ? undefined : str(row.size_request),
    isMulbong: row.is_mulbong === true,
    hasAerator: row.has_aerator === true,
    isPacked: row.is_packed === true,
    unshippedQuantity: num(row.unshipped_quantity ?? 0),
    changeStatus: str(row.change_status) as ChangeStatus,
  };
}

export function applyItemChange(snapshot: OrderSnapshot, change: ItemChange): OrderSnapshot | null {
  if (change.eventType === 'DELETE') {
    // 삭제 신호는 기본 설정에서 기본키(id)만 담고 있다.
    const id = str(change.old.id);
    if (!id || !snapshot.items.some((i) => i.id === id)) return null;
    return { ...snapshot, items: snapshot.items.filter((i) => i.id !== id) };
  }
  const row = change.new;
  const id = str(row.id);
  if (!id) return null;
  const existing = snapshot.items.find((i) => i.id === id);
  if (change.eventType === 'INSERT') {
    if (existing) return null; // 이미 아는 줄(서버 데이터가 먼저 왔다)
    const dailyBusinessId = str(row.daily_business_id);
    if (!snapshot.rows.some((r) => r.dailyBusinessId === dailyBusinessId)) return null; // 이 화면에 없는 카드(다른 날짜 등)
    return { ...snapshot, items: [...snapshot.items, toItem(row, dailyBusinessId)] };
  }
  if (!existing) return null;
  return { ...snapshot, items: snapshot.items.map((i) => (i.id === id ? toItem(row, existing.dailyBusinessId) : i)) };
}
