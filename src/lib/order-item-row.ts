// 주문 입력에서 새 상품 줄 한 건을 order_items에 넣을 모양으로 만든다.
//
// 여러 줄을 한 번에 insert할 때 supabase-js는 모든 줄의 열 이름을 합쳐 보내고, 어떤 줄에 없는 열은 DB 기본값이 아니라 NULL로 보낸다.
// 그래서 줄마다 열 조합이 달라지면(예: AI가 고친 줄에만 ai_repaired를 넣으면) not null 열이 NULL이 되어 전체 저장이 실패한다(2026-11-15 사고).
// 모든 줄이 항상 같은 열을 갖도록 여기 한 곳에서만 만든다(순수 함수라 테스트로 열 조합을 고정한다).
import type { SizeSpec } from './size-spec.ts';

interface NewOrderItemProduct {
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  isMulbong: boolean;
  hasAerator: boolean;
  mulbongBoxCount: number | null;
  hasIcePack: boolean;
  fromStock: boolean;
  needsReview: boolean;
  reviewReason?: string;
}

export interface NewOrderItemInput {
  dailyBusinessId: string;
  sequence: number;
  product: NewOrderItemProduct;
  sizeSpec: SizeSpec;
  aiRepaired: boolean;
  isFirstInputOfDay: boolean;
  userId: string | null;
}

export function newOrderItemRow(input: NewOrderItemInput) {
  const { product } = input;
  return {
    daily_business_id: input.dailyBusinessId,
    product_sequence: input.sequence,
    product_name_raw: product.productName,
    quantity: product.quantity,
    unit: product.unit,
    secondary_weight_kg: product.secondaryWeightKg,
    size_request: product.sizeRequest,
    size_spec: input.sizeSpec,
    is_mulbong: product.isMulbong,
    has_aerator: product.hasAerator,
    mulbong_box_count: product.mulbongBoxCount,
    has_ice_pack: product.hasIcePack,
    from_stock: product.fromStock,
    change_status: input.isFirstInputOfDay ? ('none' as const) : ('new' as const),
    needs_review: product.needsReview,
    review_reason: product.reviewReason ?? null,
    ai_repaired: input.aiRepaired,
    created_by: input.userId,
  };
}
