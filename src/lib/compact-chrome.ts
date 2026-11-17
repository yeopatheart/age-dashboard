// 주문 목록 모니터 1·2(split 모드)의 상단 도구줄과 표 머리 크기(순수 상수).
// 65인치 칠판에서는 상단·표 머리가 지금처럼 클 필요가 없어서, 모니터 1·2에서만 줄여 줄 영역(availHeight)을 키운다(docs/decisions/2026-11-17-compact-toolbar-and-header.md).
// 전체 보기·휴대폰은 FULL 그대로다. 높이는 숫자와 Tailwind 클래스가 같은 값을 가리켜야 하므로 한 곳에 두고, 단위 테스트가 둘이 어긋나지 않는지 본다.
// Tailwind는 클래스 이름을 소스에서 글자 그대로 찾으므로 클래스는 조합하지 않고 통째로 적는다.

export interface ChromeMetrics {
  barPadY: number; // 도구줄 위·아래 여백(px)
  ctl: number; // 도구줄 버튼 높이(px). 칠판은 손가락·펜으로 누르므로 28px 아래로 줄이지 않는다.
  headPadY: number; // 표 머리 칸 위·아래 여백(px)
  headLine: number; // 표 머리 글자 줄 높이(px)
  pageGap: number; // 도구줄과 표 카드 사이(px)
  bar: string; // 도구줄 안쪽 여백 클래스
  ctlH: string; // 높이가 ctl인 버튼
  sq: string; // ctl × ctl 정사각 버튼
  icon: string; // 버튼 안 아이콘
  badgePos: string; // 벨 버튼 모서리의 개수 배지 위치(도구줄 위 여백이 줄어 배지가 도구줄 밖으로 나가지 않게 한다)
  menuTop: string; // 버튼 아래로 8px 떨어져 뜨는 드롭다운의 top
  date: string; // 날짜 글자 칸(높이는 ctl)
  headCell: string; // 표 머리 칸 위·아래 여백
  headText: string; // 표 머리 글자 크기·줄 높이
  gap: string; // 도구줄과 표 카드 사이 간격
  chipFs: number; // 터미널별 박스 칩 기본 글자(px)
  chipPadY: number; // 칩 위·아래 여백(px)
  chipSteps: [number, number][]; // 칩 줄이 한 줄에 안 들어갈 때 쓰는 [글자 px, 좌우 여백 px] 단계(첫 단계가 기본)
}

export const CHROME_FULL: ChromeMetrics = {
  barPadY: 8,
  ctl: 32,
  headPadY: 6,
  headLine: 16,
  pageGap: 8,
  bar: 'px-3 py-2',
  ctlH: 'h-8',
  sq: 'w-8 h-8',
  icon: 'w-4 h-4',
  badgePos: '-top-1.5 -right-1.5',
  menuTop: 'top-10',
  date: 'text-sm px-2 py-1',
  headCell: 'py-1.5',
  headText: 'text-xs',
  gap: 'gap-2',
  chipFs: 12,
  chipPadY: 2,
  chipSteps: [[12, 8], [11, 6], [10, 5], [9, 4]],
};

export const CHROME_COMPACT: ChromeMetrics = {
  barPadY: 3,
  ctl: 28,
  headPadY: 2,
  headLine: 14,
  pageGap: 4,
  bar: 'px-3 py-[3px]',
  ctlH: 'h-7',
  sq: 'w-7 h-7',
  icon: 'w-3.5 h-3.5',
  badgePos: '-top-1 -right-1',
  menuTop: 'top-9',
  date: 'text-xs px-2 h-7',
  headCell: 'py-0.5',
  headText: 'text-[11px] leading-[14px]',
  gap: 'gap-1',
  chipFs: 11,
  chipPadY: 1,
  // 11px 아래 단계는 이름이 긴 터미널이 많아 폭이 모자랄 때만 쓰는 예전과 같은 폴백이다(기본은 11px).
  chipSteps: [[11, 8], [11, 6], [10, 5], [9, 4]],
};

const BORDER_BAR = 2; // 도구줄 위·아래 테두리 1px씩
const BORDER_HEAD = 2; // 표 머리 칸 아래 테두리(border-b-2)

export const chromeFor = (compact: boolean): ChromeMetrics => (compact ? CHROME_COMPACT : CHROME_FULL);
export const toolbarHeight = (m: ChromeMetrics): number => 2 * m.barPadY + m.ctl + BORDER_BAR;
export const headerHeight = (m: ChromeMetrics): number => 2 * m.headPadY + m.headLine + BORDER_HEAD;
// 기준 화면 높이에서 줄 영역(availHeight) 추정: 기준 높이 − 도구줄 − 바깥 간격 − 표 카드 테두리(2) − 표 머리.
export const estimateAvailHeight = (stageH: number, m: ChromeMetrics): number => stageH - toolbarHeight(m) - m.pageGap - 2 - headerHeight(m);
