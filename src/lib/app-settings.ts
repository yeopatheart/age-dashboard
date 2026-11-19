// 시스템 설정(config)의 키, 기본값, 검증. 값은 app_settings 테이블(key/value jsonb)에 저장하고, 저장된 값이 없으면
// 여기의 기본값을 쓴다. 서버/클라이언트 어디서나 쓸 수 있게 DB 접근은 이 파일에 넣지 않는다.
import { DEFAULT_SCAN_SHARE_TEMPLATE, normalizeScanShareTemplate, type ScanShareTemplate } from './scan-share-template.ts';

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
  // 송장 라벨에 찍는 상호와 연락처
  companyName: string;
  contactPhone: string;
  // 상차 스캔에서 터미널별로 카카오톡에 보내는 상차 완료 글의 형식(문구 + {변수})
  scanShare: ScanShareTemplate;
  // 칠판 필기를 서버 이력(board_ink_history)으로 남기는 최소 간격(분). 정기 점검 함수(0068·0070)가 이 값을 읽는다. 키 이름도 DB와 같다.
  boardInkSnapshotMinutes: number;
  // 이력을 남기는 시간대(한국 시간, 시). 시작 시각의 정각부터 종료 시각의 정각까지(종료 정각 포함, 예: 4~16이면 04:00~16:00).
  // 시작이 종료보다 크면 자정을 넘기는 시간대(22~6), 같으면 하루 종일. 시간대 밖에서는 정기 이력을 남기지 않는다(필기가 크게 줄었을 때의 이력은 시간과 상관없이 남긴다). 키 이름도 DB와 같다(0070).
  boardInkSnapshotStartHour: number;
  boardInkSnapshotEndHour: number;
}

export const BOARD_INK_SNAPSHOT_MINUTES_MIN = 5;
export const BOARD_INK_SNAPSHOT_MINUTES_MAX = 240;
export const BOARD_INK_SNAPSHOT_HOUR_MIN = 0;
export const BOARD_INK_SNAPSHOT_HOUR_MAX = 23;

export const DEFAULT_SETTINGS: AppSettings = {
  sizeTolerancePct: 10,
  earlyRangeKg: 0.4,
  perKgTolerancePct: 10,
  pendingKeywords: ['확인중', '확인 중'],
  optionalKeywords: ['가능하면'],
  unshippedReasons: ['재고없음', '폐사', '품질불량'],
  allowPastOrderEdit: false,
  companyName: '통영아재수산',
  contactPhone: '',
  scanShare: DEFAULT_SCAN_SHARE_TEMPLATE,
  boardInkSnapshotMinutes: 10,
  boardInkSnapshotStartHour: 4,
  boardInkSnapshotEndHour: 16,
};

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v.trim().slice(0, 60) : fallback);
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
    companyName: text(s.companyName, d.companyName),
    contactPhone: text(s.contactPhone, d.contactPhone),
    scanShare: normalizeScanShareTemplate(s.scanShare),
    // 분 단위 정수만 쓴다(트리거도 소수는 내림한다). 범위를 벗어나면 기본값으로 되돌린다.
    boardInkSnapshotMinutes: Math.round(num(s.boardInkSnapshotMinutes, d.boardInkSnapshotMinutes, BOARD_INK_SNAPSHOT_MINUTES_MIN, BOARD_INK_SNAPSHOT_MINUTES_MAX)),
    // 시각은 0~23 정수만 쓴다. 범위를 벗어나면 기본값으로 되돌린다.
    boardInkSnapshotStartHour: Math.round(num(s.boardInkSnapshotStartHour, d.boardInkSnapshotStartHour, BOARD_INK_SNAPSHOT_HOUR_MIN, BOARD_INK_SNAPSHOT_HOUR_MAX)),
    boardInkSnapshotEndHour: Math.round(num(s.boardInkSnapshotEndHour, d.boardInkSnapshotEndHour, BOARD_INK_SNAPSHOT_HOUR_MIN, BOARD_INK_SNAPSHOT_HOUR_MAX)),
  };
}
