// 스마트 칠판이 "펜으로 쓸 수 있는 기기"로 판정됐는지, 아니면 왜 막혔는지를 서버 로그(Vercel Logs의 `[board-env]`)에 한 줄 남기기 위한 값과 검사(순수 함수).
// 2026-11-16 현장에서 배포 직후 칠판의 펜이 PC 화면처럼 막힌 적이 있는데, 원인을 가릴 정보가 없었다. 동작은 바꾸지 않고 값만 남긴다.
// 개인정보는 담지 않는다(화면 크기·터치 점 수·브라우저 종류·판정 조건뿐이다).

export interface InkWriterTerms {
  penAvailable: boolean; // 터치가 있는 데스크톱 화면으로 판별됐나
  isSplitMode: boolean; // 모니터 1·2 보기인가
  stageNative: boolean; // 기준 화면 배율이 걸리지 않았나
  canEdit: boolean; // 주문 목록 편집 권한이 있나
  dateAllowsEdit: boolean; // 오늘이거나 지난 날짜 편집이 허용됐나
}

// 펜으로 쓸 수 없는 이유(없으면 빈 배열 = 쓸 수 있다). 대시보드의 inkWriter 식과 같은 조건이다.
export function inkBlockers(t: InkWriterTerms): string[] {
  const out: string[] = [];
  if (!t.penAvailable) out.push('penAvailable=false(터치 데스크톱으로 판별 안 됨)');
  if (!t.isSplitMode) out.push('isSplitMode=false(모니터 1·2 보기가 아님)');
  if (!t.stageNative) out.push('stageNative=false(기준 화면 배율이 걸림)');
  if (!t.canEdit) out.push('canEdit=false(주문 목록 편집 권한 없음)');
  if (!t.dateAllowsEdit) out.push('dateAllowsEdit=false(지난 날짜이고 지난 날짜 편집이 꺼져 있음)');
  return out;
}

export interface BoardEnvReport {
  // 브라우저·기기
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  visualViewportScale: number | null;
  maxTouchPoints: number;
  userAgent: string;
  platform: string;
  // 화면 상태
  monitor: string;
  orderDate: string;
  today: string;
  sidebarCollapsed: boolean | null;
  penParam: string | null; // 주소의 pen 값(강제 표시·숨김)
  stageOuterWidth: number | null; // 기준 화면 바깥 영역(주문 목록 본문)의 크기
  stageOuterHeight: number | null;
  stageScale: number;
  // 판정
  terms: InkWriterTerms;
  inkWriter: boolean;
  blockers: string[];
  inkHidden: boolean;
  seq: number; // 이 화면을 연 뒤 몇 번째 보고인가(판정이 바뀔 때만 다시 보낸다)
  sinceLoadMs: number;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, max) : '');
const bool = (v: unknown): boolean => v === true;

// 클라이언트가 보낸 값을 믿지 않고 모양·길이를 확인한다(로그에 이상한 글자가 길게 들어가지 않게). 모양이 틀리면 null.
export function parseBoardEnv(value: unknown): BoardEnvReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const t = typeof v.terms === 'object' && v.terms !== null ? (v.terms as Record<string, unknown>) : null;
  if (!t || typeof v.inkWriter !== 'boolean') return null;
  const terms: InkWriterTerms = {
    penAvailable: bool(t.penAvailable),
    isSplitMode: bool(t.isSplitMode),
    stageNative: bool(t.stageNative),
    canEdit: bool(t.canEdit),
    dateAllowsEdit: bool(t.dateAllowsEdit),
  };
  return {
    innerWidth: num(v.innerWidth),
    innerHeight: num(v.innerHeight),
    outerWidth: num(v.outerWidth),
    outerHeight: num(v.outerHeight),
    screenWidth: num(v.screenWidth),
    screenHeight: num(v.screenHeight),
    devicePixelRatio: num(v.devicePixelRatio, 1),
    visualViewportWidth: numOrNull(v.visualViewportWidth),
    visualViewportHeight: numOrNull(v.visualViewportHeight),
    visualViewportScale: numOrNull(v.visualViewportScale),
    maxTouchPoints: num(v.maxTouchPoints),
    userAgent: str(v.userAgent, 300),
    platform: str(v.platform, 60),
    monitor: str(v.monitor, 10),
    orderDate: str(v.orderDate, 10),
    today: str(v.today, 10),
    sidebarCollapsed: typeof v.sidebarCollapsed === 'boolean' ? v.sidebarCollapsed : null,
    penParam: v.penParam === null || v.penParam === undefined ? null : str(v.penParam, 5),
    stageOuterWidth: numOrNull(v.stageOuterWidth),
    stageOuterHeight: numOrNull(v.stageOuterHeight),
    stageScale: num(v.stageScale, 1),
    terms,
    inkWriter: v.inkWriter,
    blockers: inkBlockers(terms), // 보낸 값이 아니라 판정 조건에서 다시 만든다
    inkHidden: bool(v.inkHidden),
    seq: Math.max(1, Math.min(20, Math.round(num(v.seq, 1)))),
    sinceLoadMs: Math.max(0, Math.round(num(v.sinceLoadMs))),
  };
}
