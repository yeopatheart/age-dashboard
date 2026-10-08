// supabase/migrations/*.sql 스키마를 손으로 옮긴 타입.
// Supabase 프로젝트 연결 후 아래 명령으로 자동 생성본으로 교체한다:
//   npx supabase gen types typescript --linked > src/lib/types/database.ts

type Profile = {
  id: string;
  display_name: string;
  created_at: string;
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
};

type Business = {
  id: string;
  name: string;
  terminal_id: string | null;
  notes: string | null;
  created_at: string;
  created_via: CreatedVia;
};

type Product = {
  id: string;
  name: string;
  category: string | null;
  default_unit: string | null;
  notes: string | null;
  created_at: string;
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
  next_product_sequence: number;
  // Figma 매트릭스의 "박스" 열 — 상품별 박스 추천과 별개로 사람이 직접 세서 적는 값
  total_boxes: number;
  // 주문 입력의 줄 끝 "#메모" — 포장 담당에게 전하는 자유 메모
  memo: string | null;
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
  measured_value: string | null;
  measured_weight_kg: number | null;
  is_packed: boolean;
  packed_at: string | null;
  box_result: string | null;
  needs_review: boolean;
  review_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type DailyBusinessBox = {
  id: string;
  daily_business_id: string;
  box_id: string;
  quantity: number;
  created_at: string;
};

type KakaoMessageLog = {
  id: string;
  order_date: string;
  raw_text: string;
  created_by: string | null;
  created_at: string;
};

type CardPhotoStatus = "pending" | "done";

type CardPhoto = {
  id: string;
  order_date: string;
  storage_path: string;
  status: CardPhotoStatus;
  taken_by: string | null;
  taken_at: string;
};

type MatchStatus = "matched" | "unmatched" | "ambiguous" | "needs_review";

type CardReading = {
  id: string;
  card_photo_id: string;
  raw_code: string | null;
  raw_value: string | null;
  business_number: number | null;
  product_sequence: number | null;
  matched_order_item_id: string | null;
  match_status: MatchStatus;
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
      access_log: TableDef<
        AccessLog,
        Pick<AccessLog, "user_id"> & { id?: string; event?: string; created_at?: string }
      >;
      terminals: TableDef<Terminal, Pick<Terminal, "name"> & { id?: string; created_at?: string; created_via?: CreatedVia }>;
      businesses: TableDef<
        Business,
        Pick<Business, "name"> & {
          id?: string;
          terminal_id?: string | null;
          notes?: string | null;
          created_at?: string;
          created_via?: CreatedVia;
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
          total_boxes?: number;
          memo?: string | null;
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
          measured_value?: string | null;
          measured_weight_kg?: number | null;
          is_packed?: boolean;
          packed_at?: string | null;
          box_result?: string | null;
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
          created_by?: string | null;
          created_at?: string;
        }
      >;
      card_photos: TableDef<
        CardPhoto,
        Pick<CardPhoto, "order_date" | "storage_path"> & {
          id?: string;
          status?: CardPhotoStatus;
          taken_by?: string | null;
          taken_at?: string;
        }
      >;
      card_readings: TableDef<
        CardReading,
        Pick<CardReading, "card_photo_id"> & {
          id?: string;
          raw_code?: string | null;
          raw_value?: string | null;
          business_number?: number | null;
          product_sequence?: number | null;
          matched_order_item_id?: string | null;
          match_status?: MatchStatus;
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
      daily_business_boxes: TableDef<
        DailyBusinessBox,
        Pick<DailyBusinessBox, "daily_business_id" | "box_id" | "quantity"> & { id?: string; created_at?: string }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      assign_business_number: {
        Args: { p_order_date: string };
        Returns: number;
      };
      assign_product_sequence: {
        Args: { p_daily_business_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
