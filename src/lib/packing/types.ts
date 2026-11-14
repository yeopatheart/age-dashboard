// 박스 할당 화면과 그 데이터 로더가 함께 쓰는 타입(서버에서 읽어 화면에 넘기는 모양).
import type { LabelPrintStatus } from '../label-status';
import type { RecommendationView } from './server';
import type { ExcludedItem } from './excluded-items';

export interface PackingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  weightKg: number | null;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  needsMulbong: boolean;
  // 주문에 "기포기"가 적힌 상품 — 물봉에 기포기를 부착해서 내보낸다
  aerator: boolean;
  // 주문에 "물봉"이 적힌 상품(기포기가 아닌 물봉만)
  orderMulbong: boolean;
}
export interface PackingBusiness {
  id: string;
  number: number;
  businessName: string;
  // 같은 고객사가 1차·2차 모두 있을 때만 값이 있다
  roundLabel: string | null;
  terminal: string;
  // 택배 터미널: 택배사 송장을 붙이므로 박스 라벨을 출력하지 않는다
  parcel: boolean;
  items: PackingItem[];
  // 박스에 담을 대상이 아니라 items에서 빠진 상품(수량 미정·전량 미출고). 조용히 빠지지 않게 화면이 안내한다.
  excludedItems: ExcludedItem[];
  // 박스 추천(shadow test). 미제출 업체는 1순위 추천이 박스에 미리 채워진다.
  recommendation: RecommendationView | null;
  // 제출한 업체의 라벨 출력 현황(목록 칩용). 택배·미제출 업체는 null
  labelStatus: LabelPrintStatus | null;
  // 미제출: 추천을 만든 뒤 주문이 바뀜 / 제출: 제출한 뒤 주문이 바뀜
  orderChanged: boolean;
  submitted: {
    submittedAt: string;
    boxes: { boxId: string | null; boxName: string; items: { orderItemId: string; quantity: number }[] }[];
  } | null;
}
export interface PackingBoxType {
  id: string;
  name: string;
  is_active: boolean;
  inner_width_cm: number | null;
  inner_depth_cm: number | null;
  inner_height_cm: number | null;
  is_mulbong_box: boolean;
}
