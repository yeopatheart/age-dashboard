// 상차 완료 카카오톡 메시지의 "형식"(템플릿): 문구 + {변수}. 시스템 설정에서 바꾸고 상차 스캔 화면이 읽어 쓴다.
// 순수 함수와 값만 둔다(DB·화면 접근 없음). 서버·클라이언트·테스트가 모두 쓴다.
//
// 글은 네 줄 종류로 이뤄진다(순서 고정): 첫 줄 → 업체별 줄(업체마다 반복) → 합계 줄 → 미상차 줄(미상차가 있을 때만).
// 각 줄은 한 줄짜리 글이고, 그 줄에서 쓸 수 있는 변수만 {변수명}으로 넣는다. 줄을 비우면 그 줄은 글에서 빠진다.

export type ShareSlot = 'header' | 'line' | 'total' | 'pending';
export type ShareDateFormat = 'md-weekday' | 'korean' | 'iso';

export interface ScanShareTemplate {
  header: string;
  line: string;
  total: string;
  pending: string;
  showPending: boolean; // 끄면 미상차 줄은 미상차가 있어도 넣지 않는다
  dateFormat: ShareDateFormat;
}

// 기본값은 변수 기능을 넣기 전의 고정 문구와 똑같이 만든다(설정을 건드리지 않으면 글이 달라지지 않는다).
export const DEFAULT_SCAN_SHARE_TEMPLATE: ScanShareTemplate = {
  header: '{날짜} {터미널명} 상차 완료',
  line: '{고객사명} {박스수}박스',
  total: '합계 {합계}박스',
  pending: '⚠ 미상차: {미상차목록}',
  showPending: true,
  dateFormat: 'md-weekday',
};

export const SHARE_SLOTS: ShareSlot[] = ['header', 'line', 'total', 'pending'];

export const SHARE_SLOT_LABEL: Record<ShareSlot, string> = {
  header: '첫 줄',
  line: '업체별 줄 (업체마다 한 줄씩 반복)',
  total: '합계 줄',
  pending: '미상차 줄 (미상차가 있을 때만)',
};

// 줄마다 쓸 수 있는 변수와 설명. 설정 화면의 변수 칩과 저장 검증이 이 표를 같이 쓴다.
export const SHARE_VARIABLES: Record<ShareSlot, { name: string; hint: string }[]> = {
  header: [
    { name: '날짜', hint: '주문 날짜 (형식은 아래에서 고릅니다)' },
    { name: '터미널명', hint: '이 글을 보내는 터미널' },
    { name: '업체수', hint: '상차가 끝난 박스가 있는 고객사 수' },
    { name: '합계', hint: '상차한 박스 합계' },
  ],
  line: [
    { name: '고객사명', hint: '고객사 이름' },
    { name: '박스수', hint: '모두 상차면 숫자, 일부만 상차면 "3/5"' },
    { name: '상차박스', hint: '상차한 박스 수(숫자)' },
    { name: '전체박스', hint: '전체 박스 수(숫자)' },
  ],
  total: [
    { name: '합계', hint: '상차한 박스 합계' },
    { name: '업체수', hint: '상차가 끝난 박스가 있는 고객사 수' },
    { name: '날짜', hint: '주문 날짜' },
    { name: '터미널명', hint: '이 글을 보내는 터미널' },
  ],
  pending: [
    { name: '미상차목록', hint: '"업체 2박스 / 업체 1박스" 모양의 목록' },
    { name: '날짜', hint: '주문 날짜' },
    { name: '터미널명', hint: '이 글을 보내는 터미널' },
  ],
};

export const SHARE_DATE_FORMATS: { key: ShareDateFormat; label: string; example: string }[] = [
  { key: 'md-weekday', label: '11/06(금)', example: '11/06(금)' },
  { key: 'korean', label: '11월 6일(금)', example: '11월 6일(금)' },
  { key: 'iso', label: '2026-11-06', example: '2026-11-06' },
];

export const SHARE_SLOT_MAX_CHARS = 120;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD' → 고른 형식의 날짜 글. Date를 로컬 시간대로 만들면 하루 어긋날 수 있어 UTC로 요일만 구한다.
export function formatShareDate(orderDate: string, format: ShareDateFormat): string {
  const [y, m, d] = orderDate.split('-').map(Number);
  if (!y || !m || !d) return orderDate;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (format === 'iso') return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (format === 'korean') return `${m}월 ${d}일(${weekday})`;
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}(${weekday})`;
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

// 저장된 값(알 수 없는 모양일 수 있음)을 안전한 템플릿으로 만든다. 문자열이 아니면 기본값, 줄바꿈은 공백으로 바꾼다.
export function normalizeScanShareTemplate(raw: unknown): ScanShareTemplate {
  const d = DEFAULT_SCAN_SHARE_TEMPLATE;
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (x: unknown, fallback: string) => (typeof x === 'string' ? x.replace(/[\r\n]+/g, ' ') : fallback);
  return {
    header: str(v.header, d.header),
    line: str(v.line, d.line),
    total: str(v.total, d.total),
    pending: str(v.pending, d.pending),
    showPending: typeof v.showPending === 'boolean' ? v.showPending : d.showPending,
    dateFormat: SHARE_DATE_FORMATS.some((f) => f.key === v.dateFormat) ? (v.dateFormat as ShareDateFormat) : d.dateFormat,
  };
}

// 한 줄 글의 문제를 사용자에게 보여줄 문장으로 돌려준다(없으면 null). 모르는 변수·그 줄에서 못 쓰는 변수·짝이 안 맞는 중괄호·너무 긴 글을 거른다.
export function shareSlotError(slot: ShareSlot, text: string): string | null {
  const label = SHARE_SLOT_LABEL[slot].replace(/ \(.*\)$/, '');
  if (text.length > SHARE_SLOT_MAX_CHARS) return `${label}은(는) ${SHARE_SLOT_MAX_CHARS}자까지 쓸 수 있습니다.`;
  const allowed = new Set(SHARE_VARIABLES[slot].map((x) => x.name));
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (!allowed.has(name)) {
      const known = [...allowed].map((n) => `{${n}}`).join(' ');
      return `${label}에서 쓸 수 없는 변수 {${name}}입니다. 쓸 수 있는 변수: ${known}`;
    }
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) return `${label}에 중괄호 { } 짝이 맞지 않는 곳이 있습니다.`;
  return null;
}

export function shareTemplateError(t: ScanShareTemplate): string | null {
  for (const slot of SHARE_SLOTS) {
    const error = shareSlotError(slot, t[slot]);
    if (error) return error;
  }
  return null;
}

// 줄 안의 {변수}를 값으로 바꾼다. 모르는 변수는 그대로 둔다(저장할 때 이미 걸러진다).
export function renderShareSlot(text: string, vars: Record<string, string | number>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
