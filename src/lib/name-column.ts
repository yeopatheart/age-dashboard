// 주문 목록 표의 고객명 열·터미널 열 폭 계산(순수 함수). 글자 폭을 재는 일(canvas.measureText)은 호출하는 쪽이 `measure`로 넘긴다.
//
// 고객명 칸 안에는 이름 말고도 완료/취소 표시, 1·2차 배지, 메모 점이 같이 들어간다. 이 몫을 폭에 넣지 않으면 그 표시가 붙은 줄의 긴 이름이
// 칸 밖(overflow-hidden)으로 밀려 잘린다(2026-11-17 현장: 완료·취소 줄의 긴 이름이 약 19px 잘렸다. 예전에는 완료 배지를 "상태에 따라
// 붙었다 떨어지니" 폭에서 일부러 뺐고, 3px 여유로는 배지 몫을 덮지 못했다). 그래서 완료/취소 표시 몫은 줄의 상태와 무관하게 항상 예약한다 —
// 같은 이름 목록이면 줄이 완료돼도 열 폭이 바뀌지 않는다(폭이 바뀌면 줄 폭 비율로 저장된 줄 안 필기가 가로로 움직인다).
// 결정: docs/decisions/2026-11-17-name-column-status-icon.md

export type MeasureText = (text: string) => number;

export const NAME_COLUMN_MIN = 72;
export const NAME_COLUMN_MAX = 220;
export const ROUND_BADGE_WIDTH = 28; // RoundBadge("1차") 폭 + 오른쪽 간격
export const MEMO_DOT_WIDTH = 10; // 메모 점: w-1.5(6) + ml-1(4)
// 칸 좌우 여백(px-2 = 16) + 오른쪽 경계선 1 + 반올림 여유 3
const NAME_COLUMN_PADDING = 20;

// 완료/취소 표시 슬롯 폭.
// dense(줄 30px 미만): 테두리·배경 없는 아이콘(10~12px) + 오른쪽 간격 2px = 14px. 아이콘이 가장 큰 12px일 때도 2px 간격이 남는다.
// 그 외(전체 보기): 글자 배지가 그대로 들어간다. 완료 배지 = 테두리 2 + px-1 8 + 체크 10 + gap 2 + "완료"(10px 굵게 한글 2자 = 20) + mr-1 4 = 46,
// 취소 배지는 34라 큰 쪽(완료)을 따른다. 한글 한 글자 폭은 1em(Noto Sans KR 전각)이라고 본 값이라 2px 여유를 더해 48.
export const STATUS_SLOT_DENSE = 14;
export const STATUS_SLOT_FULL = 48;
export const statusSlotWidth = (dense: boolean) => (dense ? STATUS_SLOT_DENSE : STATUS_SLOT_FULL);

export interface NameColumnEntry {
  name: string;
  round: boolean; // 1·2차 배지가 붙는 고객(같은 고객사가 1차·2차에 모두 있음)
  memo: boolean; // 메모 점이 붙는 줄
}

// 가장 긴 줄(이름 + 완료/취소 슬롯 + 1·2차 배지 + 메모 점)을 한 줄로 그릴 수 있는 폭. measure는 업체명 글자 크기·굵기로 맞춘 측정기.
export function nameColumnWidth(entries: readonly NameColumnEntry[], dense: boolean, measure: MeasureText): number {
  const slot = statusSlotWidth(dense);
  const widest = entries.reduce((max, e) => Math.max(max, measure(e.name) + slot + (e.round ? ROUND_BADGE_WIDTH : 0) + (e.memo ? MEMO_DOT_WIDTH : 0)), 0);
  return Math.min(NAME_COLUMN_MAX, Math.max(NAME_COLUMN_MIN, Math.ceil(widest) + NAME_COLUMN_PADDING));
}

export const TERMINAL_COLUMN_MIN = 56; // 표 머리 "터미널"(12px 굵게 약 36px + 칸 여백 16 + 경계선 1)이 들어가는 폭
export const TERMINAL_COLUMN_MAX = 120;
export const TERMINAL_CHIP_DENSE_FONT_MAX = 9;
const TERMINAL_CHIP_FULL_FONT = 11;
const TERMINAL_CHIP_PAD_X = { dense: 6, full: 8 }; // dense px-1.5, 그 외 px-2

// 터미널 칩 글자 크기. 표시(style)와 열 폭 측정이 같은 값을 쓰도록 한 곳에 둔다.
export const terminalChipFontPx = (dense: boolean, rowHeight: number) => (dense ? Math.min(TERMINAL_CHIP_DENSE_FONT_MAX, rowHeight - 5) : TERMINAL_CHIP_FULL_FONT);

// 가장 긴 터미널 이름 칩을 한 줄로 그릴 수 있는 폭: 글자 + 칩 좌우 패딩 + 칩 테두리 2 + 칸 좌우 여백(px-2 = 16) + 경계선·반올림 여유 4.
export function terminalColumnWidth(names: readonly string[], dense: boolean, measure: MeasureText): number {
  const widest = names.reduce((max, name) => Math.max(max, measure(name)), 0);
  const chipPad = (dense ? TERMINAL_CHIP_PAD_X.dense : TERMINAL_CHIP_PAD_X.full) * 2;
  return Math.min(TERMINAL_COLUMN_MAX, Math.max(TERMINAL_COLUMN_MIN, Math.ceil(widest) + chipPad + 2 + 16 + 4));
}
