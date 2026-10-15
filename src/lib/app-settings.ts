// 시스템 설정(config)의 키, 기본값, 검증. 값은 app_settings 테이블(key/value jsonb)에 저장하고, 저장된 값이 없으면
// 여기의 기본값을 쓴다. 서버/클라이언트 어디서나 쓸 수 있게 DB 접근은 이 파일에 넣지 않는다.
export interface AppSettings {
  // 요구사항 해석
  sizeTolerancePct: number; // "2.5kg내외"의 허용 오차(±%)
  earlyRangeKg: number; // "3kg초반" = 3.0 ~ 3.0+이 값(kg)
  perKgTolerancePct: number; // "키로 3미"(킬로당 N마리)의 마리당 중량 허용 오차(±%)
  // 키워드 목록(쉼표로 구분해서 입력)
  pendingKeywords: string[]; // 고객 확인 전의 임시 주문 표시(예: 확인중) — 취소될 수 있고, 형의 확정은 필요 없음
  optionalKeywords: string[]; // 상품이 확보되면 준비하는 주문 표시(예: 가능하면)
  // 미출고 사유 선택지
  unshippedReasons: string[];
  // 켜면 오늘 이전 날짜의 주문 입력·수정과 박스 기록 편집을 허용한다(미래 날짜는 항상 막는다).
  allowPastOrderEdit: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sizeTolerancePct: 10,
  earlyRangeKg: 0.4,
  perKgTolerancePct: 10,
  pendingKeywords: ['확인중', '확인 중'],
  optionalKeywords: ['가능하면'],
  unshippedReasons: ['재고없음', '폐사', '품질불량'],
  allowPastOrderEdit: false,
};

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const list = (v: unknown, fallback: string[]) =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : fallback;

// DB에서 읽은 {key: value} 맵을 기본값과 합쳐서 안전한 설정 객체로 만든다(잘못된 값은 기본값으로 되돌린다).
export function mergeSettings(stored: Record<string, unknown> | null | undefined): AppSettings {
  const s = stored ?? {};
  const d = DEFAULT_SETTINGS;
  return {
    sizeTolerancePct: num(s.sizeTolerancePct, d.sizeTolerancePct, 0, 100),
    earlyRangeKg: num(s.earlyRangeKg, d.earlyRangeKg, 0, 5),
    perKgTolerancePct: num(s.perKgTolerancePct, d.perKgTolerancePct, 0, 100),
    pendingKeywords: list(s.pendingKeywords, d.pendingKeywords),
    optionalKeywords: list(s.optionalKeywords, d.optionalKeywords),
    unshippedReasons: list(s.unshippedReasons, d.unshippedReasons),
    allowPastOrderEdit: typeof s.allowPastOrderEdit === 'boolean' ? s.allowPastOrderEdit : d.allowPastOrderEdit,
  };
}
