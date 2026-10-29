// supabase/migrations/*.sql 스키마를 손으로 옮긴 타입.
// Supabase 프로젝트 연결 후 아래 명령으로 자동 생성본으로 교체한다:
//   npx supabase gen types typescript --linked > src/lib/types/database.ts

import type { SizeSpec } from "@/lib/size-spec";

type Profile = {
  id: string;
  display_name: string;
  created_at: string;
};

type UserPermissions = {
  user_id: string;
  permissions: string[];
  updated_at: string;
};

type AccessLog = {
  id: string;
  user_id: string | null;
  event: string;
  created_at: string;
};

type CreatedVia = "order" | "manual";

type Terminal = {
  id: string;
  name: string;
  created_at: string;
  created_via: CreatedVia;
  fill_color: string | null;
  border_color: string | null;
  // true면 대시보드 기본 주문표에서 빼고 "별도 주문"으로 따로 본다(택배, 직배송 등).
  is_separate: boolean;
  // true면 택배사 송장을 붙이는 택배 터미널(박스 라벨을 출력·스캔하지 않는다). 별도 주문 중에서만 지정한다.
  is_parcel: boolean;
};

type Business = {
  id: string;
  name: string;
  terminal_id: string | null;
  notes: string | null;
  created_at: string;
  created_via: CreatedVia;
  // 선택 입력(0024). 사업자등록번호는 000-00-00000 형식.
  business_registration_no: string | null;
  representative_name: string | null;
};

type Product = {
  id: string;
  name: string;
  category: string | null;
  default_unit: string | null;
  notes: string | null;
  created_at: string;
  // 색상은 src/lib/color-palette.ts의 key. null이면 기본 모양.
  fill_color: string | null;
  border_color: string | null;
  created_via: CreatedVia;
  // 물봉(산소) 포장이 필요한 상품 — 포장 추천 때 물봉용 박스에 담는다.
  needs_mulbong: boolean;
};

type OrderDayCounter = {
  order_date: string;
  next_business_number: number;
};

// 하루 안에서 업체 하나가 갖는 "카드". business_number는 append-only로
// assign_business_number() RPC를 통해서만 발급한다.
type DailyBusiness = {
  id: string;
  order_date: string;
  business_id: string;
  business_number: number;
  // 1차/2차 (0025) — 같은 날 같은 고객사도 차수가 다르면 별개 카드
  round: 1 | 2;
  // 표시 순서 (0025) — 드래그로 바꾼다. business_number는 발급 번호라 바뀌지 않는다.
  sort_order: number;
  next_product_sequence: number;
  // Figma 매트릭스의 "박스" 열 — 상품별 박스 추천과 별개로 사람이 직접 세서 적는 값
  total_boxes: number;
  // 주문 입력의 줄 끝 "#메모" — 포장 담당에게 전하는 자유 메모
  memo: string | null;
  // 그날 카드에서만 쓰는 고객명(0036). null이면 고객사 이름(businesses.name)을 쓴다.
  display_name: string | null;
  // 그날 카드의 터미널(0029). 고객사의 터미널(businesses.terminal_id)은 기본값일 뿐이고, 표시·집계는 이 값을 쓴다.
  terminal_id: string | null;
  created_at: string;
};

type ChangeStatus = "new" | "modified" | "cancelled" | "none";

// 화면의 "12-2" 코드는 daily_businesses.business_number + '-' + order_items.product_sequence를
// 조회 시점에 조합한 것으로, 이 테이블 자체엔 저장하지 않는다.
type OrderItem = {
  id: string;
  daily_business_id: string;
  product_sequence: number;
  product_id: string | null;
  product_name_raw: string;
  quantity: number;
  unit: string;
  secondary_weight_kg: number | null;
  size_request: string | null;
  is_mulbong: boolean;
  mulbong_box_count: number | null;
  has_ice_pack: boolean;
  from_stock: boolean;
  change_status: ChangeStatus;
  measured_weight_kg: number | null;
  is_packed: boolean;
  packed_at: string | null;
  // 미출고(0021): 주문은 유효하지만 출고하지 못한 수량. 0이면 정상. 주문취소(change_status)와 별개.
  unshipped_quantity: number;
  unshipped_reason: string | null;
  // 사이즈/종류 요구사항을 해석한 구조화 값(0022). 원문은 size_request.
  size_spec: SizeSpec | null;
  needs_review: boolean;
  review_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// 박스 기록(0020) — 제출 시점에 저장하는 "어느 박스에 어떤 상품이 담겼는지". 이름·크기는 그 시점 값의 복사본.
type PackingRecord = {
  id: string;
  daily_business_id: string;
  order_date: string;
  business_name: string;
  terminal_name: string | null;
  submitted_by: string | null;
  submitted_at: string;
  // 추천 shadow test(0027): 제출 시점의 추천과 현장 결과의 비교
  recommendation_id: string | null;
  recommended_rank: number | null;
  accepted_as_is: boolean | null;
  order_signature: string | null;
  // 상품 배치를 사람이 확인했는지(0028). null = 이전 기록
  items_verified: boolean | null;
};

// 박스 추천 모델 버전(0027). model은 src/lib/packing/model.ts의 PackingModel을 JSON으로 저장한 것.
type PackingModelVersion = {
  version: string;
  trained_at: string;
  record_count: number;
  single_box_count: number;
  model: unknown;
};

// 업체·일자별 박스 추천 스냅샷(0027). candidates의 모양은 src/lib/packing/server.ts의 StoredPlan[].
type PackingRecommendation = {
  id: string;
  daily_business_id: string;
  model_version: string;
  order_signature: string;
  confidence: "high" | "medium" | "low";
  confidence_score: number;
  candidates: unknown;
  created_at: string;
};

// 송장 라벨(0030): 라벨 디자인, 박스별 바코드, 출력·스캔 이력. elements의 모양은 src/lib/labels/template.ts의 LabelElement[].
type LabelTemplateRow = {
  kind: "label" | "top" | "side"; // 'label' = 모서리에 감아 붙이는 한 장짜리(0035). top/side는 예전 두 종류 디자인(쓰지 않는다)
  width_mm: number;
  height_mm: number;
  top_height_mm: number | null;
  side_width_mm: number | null;
  elements: unknown;
  updated_at: string;
};
type BoxLabel = {
  id: string;
  daily_business_id: string;
  seq: number;
  barcode: string;
  loaded_at: string | null;
  loaded_by: string | null;
  created_at: string;
};
type BoxLabelEvent = {
  id: string;
  label_id: string;
  event: "print" | "scan" | "undo";
  label_kind: "label" | "top" | "side" | null;
  created_at: string;
  created_by: string | null;
};

type PackingBox = {
  id: string;
  record_id: string;
  box_id: string | null;
  position: number;
  box_name: string;
  inner_width_cm: number | null;
  inner_depth_cm: number | null;
  inner_height_cm: number | null;
  is_mulbong_box: boolean;
};

type PackingBoxItem = {
  id: string;
  packing_box_id: string;
  order_item_id: string | null;
  product_name: string;
  unit: string;
  quantity: number;
  secondary_weight_kg: number | null;
  size_request: string | null;
  is_mulbong: boolean;
  needs_mulbong: boolean;
};

type KakaoMessageLog = {
  id: string;
  order_date: string;
  raw_text: string;
  // 입력 당시 선택한 차수 (0026)
  round: 1 | 2;
  created_by: string | null;
  created_at: string;
};

// 박스 포장 추천 알고리즘은 아직 없다 — 우선 실측 치수를 등록하는 참조 테이블(0011)
type Box = {
  id: string;
  name: string;
  notes: string | null;
  inner_width_cm: number | null;
  inner_depth_cm: number | null;
  inner_height_cm: number | null;
  is_mulbong_box: boolean;
  is_active: boolean;
  created_at: string;
};

// 대시보드에서 날짜별로 강조하는 상품(0023)
type DailyProductHighlight = {
  order_date: string;
  product_name: string;
  position: number;
  created_at: string;
};

type TableDef<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<Profile, Pick<Profile, "id" | "display_name">>;
      user_permissions: TableDef<UserPermissions, Pick<UserPermissions, "user_id"> & { permissions?: string[]; updated_at?: string }>;
      access_log: TableDef<
        AccessLog,
        Pick<AccessLog, "user_id"> & { id?: string; event?: string; created_at?: string }
      >;
      terminals: TableDef<
        Terminal,
        Pick<Terminal, "name"> & { id?: string; created_at?: string; created_via?: CreatedVia; fill_color?: string | null; border_color?: string | null; is_separate?: boolean; is_parcel?: boolean }
      >;
      businesses: TableDef<
        Business,
        Pick<Business, "name"> & {
          id?: string;
          terminal_id?: string | null;
          notes?: string | null;
          created_at?: string;
          created_via?: CreatedVia;
          business_registration_no?: string | null;
          representative_name?: string | null;
        }
      >;
      products: TableDef<
        Product,
        Pick<Product, "name"> & {
          id?: string;
          category?: string | null;
          default_unit?: string | null;
          notes?: string | null;
          created_at?: string;
          fill_color?: string | null;
          border_color?: string | null;
          created_via?: CreatedVia;
          needs_mulbong?: boolean;
        }
      >;
      order_day_counters: TableDef<
        OrderDayCounter,
        Pick<OrderDayCounter, "order_date"> & { next_business_number?: number }
      >;
      daily_businesses: TableDef<
        DailyBusiness,
        Pick<DailyBusiness, "order_date" | "business_id" | "business_number"> & {
          id?: string;
          next_product_sequence?: number;
          round?: 1 | 2;
          sort_order?: number;
          total_boxes?: number;
          memo?: string | null;
          display_name?: string | null;
          terminal_id?: string | null;
          created_at?: string;
        }
      >;
      order_items: TableDef<
        OrderItem,
        Pick<OrderItem, "daily_business_id" | "product_sequence" | "product_name_raw" | "quantity" | "unit"> & {
          id?: string;
          product_id?: string | null;
          secondary_weight_kg?: number | null;
          size_request?: string | null;
          is_mulbong?: boolean;
          mulbong_box_count?: number | null;
          has_ice_pack?: boolean;
          from_stock?: boolean;
          change_status?: ChangeStatus;
          measured_weight_kg?: number | null;
          is_packed?: boolean;
          packed_at?: string | null;
          unshipped_quantity?: number;
          unshipped_reason?: string | null;
          size_spec?: SizeSpec | null;
          needs_review?: boolean;
          review_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      kakao_message_log: TableDef<
        KakaoMessageLog,
        Pick<KakaoMessageLog, "order_date" | "raw_text"> & {
          id?: string;
          round?: 1 | 2;
          created_by?: string | null;
          created_at?: string;
        }
      >;
      boxes: TableDef<
        Box,
        Pick<Box, "name"> & {
          id?: string;
          notes?: string | null;
          inner_width_cm?: number | null;
          inner_depth_cm?: number | null;
          inner_height_cm?: number | null;
          is_mulbong_box?: boolean;
          is_active?: boolean;
          created_at?: string;
        }
      >;
      app_settings: TableDef<
        { key: string; value: unknown; updated_at: string },
        { key: string; value: unknown; updated_at?: string }
      >;
      daily_product_highlights: TableDef<
        DailyProductHighlight,
        Pick<DailyProductHighlight, "order_date" | "product_name" | "position"> & { created_at?: string }
      >;
      packing_records: TableDef<
        PackingRecord,
        Pick<PackingRecord, "daily_business_id" | "order_date" | "business_name"> & {
          id?: string;
          terminal_name?: string | null;
          submitted_by?: string | null;
          submitted_at?: string;
          recommendation_id?: string | null;
          recommended_rank?: number | null;
          accepted_as_is?: boolean | null;
          order_signature?: string | null;
          items_verified?: boolean | null;
        }
      >;
      packing_model_versions: TableDef<
        PackingModelVersion,
        Pick<PackingModelVersion, "version" | "record_count" | "single_box_count" | "model"> & { trained_at?: string }
      >;
      label_templates: TableDef<
        LabelTemplateRow,
        Pick<LabelTemplateRow, "kind" | "width_mm" | "height_mm" | "elements"> & { top_height_mm?: number | null; side_width_mm?: number | null; updated_at?: string }
      >;
      box_labels: TableDef<
        BoxLabel,
        Pick<BoxLabel, "daily_business_id" | "seq" | "barcode"> & { id?: string; loaded_at?: string | null; loaded_by?: string | null; created_at?: string }
      >;
      box_label_events: TableDef<
        BoxLabelEvent,
        Pick<BoxLabelEvent, "label_id" | "event"> & { id?: string; label_kind?: "label" | "top" | "side" | null; created_at?: string; created_by?: string | null }
      >;
      packing_recommendations: TableDef<
        PackingRecommendation,
        Pick<
          PackingRecommendation,
          "daily_business_id" | "model_version" | "order_signature" | "confidence" | "confidence_score" | "candidates"
        > & { id?: string; created_at?: string }
      >;
      packing_boxes: TableDef<
        PackingBox,
        Pick<PackingBox, "record_id" | "position" | "box_name"> & {
          id?: string;
          box_id?: string | null;
          inner_width_cm?: number | null;
          inner_depth_cm?: number | null;
          inner_height_cm?: number | null;
          is_mulbong_box?: boolean;
        }
      >;
      packing_box_items: TableDef<
        PackingBoxItem,
        Pick<PackingBoxItem, "packing_box_id" | "product_name" | "unit" | "quantity"> & {
          id?: string;
          order_item_id?: string | null;
          secondary_weight_kg?: number | null;
          size_request?: string | null;
          is_mulbong?: boolean;
          needs_mulbong?: boolean;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      assign_business_number: {
        Args: { p_order_date: string };
        Returns: number;
      };
      reorder_daily_businesses: {
        Args: { p_ids: string[] };
        Returns: undefined;
      };
      assign_product_sequence: {
        Args: { p_daily_business_id: string };
        Returns: number;
      };
      // 기간 리포트 집계(0017). 반환 JSON의 모양은 src/lib/report.ts의 ReportSummary.
      report_summary: {
        Args: { p_from: string; p_to: string };
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
