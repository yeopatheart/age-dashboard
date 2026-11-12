// 주문 목록에서 상품을 손으로 고칠 때의 변경 상태 규칙. 칠판(TV)은 변경 상태로 "수정된 상품"을 표시하므로,
// 일반 상품(none)의 내용을 고쳤는데 상태가 그대로면 TV에서 수정 여부를 알 수 없다.
import type { ChangeStatus } from './orders.ts';

export interface ManualItemContent {
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  isMulbong: boolean;
  hasAerator: boolean;
}

export function manualItemChanged(before: ManualItemContent, after: ManualItemContent): boolean {
  return (
    before.productName !== after.productName ||
    before.quantity !== after.quantity ||
    before.unit !== after.unit ||
    before.secondaryWeightKg !== after.secondaryWeightKg ||
    before.sizeRequest !== after.sizeRequest ||
    before.isMulbong !== after.isMulbong ||
    before.hasAerator !== after.hasAerator
  );
}

// 저장 요청의 상태(requested)를 그대로 쓰되, 현재도 none이고 요청도 none이며 내용이 실제로 바뀌었을 때만 modified로 올린다.
// 신규·취소·이미 수정됨과, 사용자가 상태를 직접 바꿔 보낸 경우는 건드리지 않는다.
export function resolveManualChangeStatus(existing: ChangeStatus, requested: ChangeStatus, changed: boolean): ChangeStatus {
  return existing === 'none' && requested === 'none' && changed ? 'modified' : requested;
}
