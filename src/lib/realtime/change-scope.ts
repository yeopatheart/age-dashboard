// 실시간 변경 신호가 "지금 보고 있는 날짜의 화면"에 해당하는지 판단한다(순수 함수).
// 신호는 날짜 구분 없이 모든 주문 줄·업체 카드의 변경이 오는데, 그때마다 화면 전체를 서버에서 다시 받으면
// 다른 날짜의 작업(과거 날짜 시험 입력, 내일 주문 입력)이 켜져 있는 모든 PC·칠판에 부하를 준다(2026-11-14 "앱이 느려졌다").
// 원칙: 확실히 다른 날짜일 때만 건너뛴다. 판단할 정보가 없으면 새로 받는다(놓치는 것보다 한 번 더 받는 편이 안전하다).
export interface LiveScope {
  orderDate: string;
  dailyIds: ReadonlySet<string>; // 이 화면의 업체 카드 id
  itemIds: ReadonlySet<string>; // 이 화면의 주문 줄 id
}

export interface RowChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// daily_businesses 변경: 이 화면의 카드이거나(수정·삭제·다른 날짜로 옮김), 이 날짜로 새로 들어온 카드면 해당한다.
export function dailyChangeInScope(scope: LiveScope, change: RowChange): boolean {
  const id = str(change.new.id) || str(change.old.id);
  if (!id) return true;
  if (scope.dailyIds.has(id)) return true;
  if (change.eventType === 'DELETE') return false; // 삭제 신호는 기본키만 담는다: 이 화면에 없는 카드면 다른 날짜의 것이다
  const date = str(change.new.order_date);
  return date ? date === scope.orderDate : true;
}

// order_items 변경: 이 화면의 카드(또는 방금 이 날짜로 들어온 카드 extraDailyIds)에 속한 줄이면 해당한다.
// 삭제 신호는 기본키(id)만 담으므로 이 화면에 있는 줄인지로 판단한다.
export function itemChangeInScope(scope: LiveScope, change: RowChange, extraDailyIds: ReadonlySet<string>): boolean {
  const dailyId = str(change.new.daily_business_id) || str(change.old.daily_business_id);
  if (dailyId) return scope.dailyIds.has(dailyId) || extraDailyIds.has(dailyId);
  const id = str(change.old.id) || str(change.new.id);
  return id ? scope.itemIds.has(id) : true;
}

// order_item_stickers(0075)·business_stickers(0076) 변경: 이 화면의 카드에 속한 스티커면 해당한다(두 테이블 모두 daily_business_id를 담는다). 새 줄·수정 신호는 daily_business_id를 담지만 삭제 신호는 기본키(id)만 담아
// 어느 카드의 것인지 알 수 없다 — 스티커를 떼는 일은 드물고 새로 받는 비용이 작으므로 삭제는 항상 새로 받는다.
export function stickerChangeInScope(scope: LiveScope, change: RowChange): boolean {
  if (change.eventType === 'DELETE') return true;
  const dailyId = str(change.new.daily_business_id);
  return dailyId ? scope.dailyIds.has(dailyId) : true;
}
