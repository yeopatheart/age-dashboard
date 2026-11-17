import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMO_DOT_WIDTH,
  NAME_COLUMN_MAX,
  NAME_COLUMN_MIN,
  ROUND_BADGE_WIDTH,
  STATUS_SLOT_DENSE,
  STATUS_SLOT_FULL,
  TERMINAL_COLUMN_MAX,
  TERMINAL_COLUMN_MIN,
  nameColumnWidth,
  statusSlotWidth,
  terminalChipFontPx,
  terminalColumnWidth,
  type NameColumnEntry,
} from './name-column.ts';

// 글자 하나를 6px로 치는 가짜 측정기(canvas 없이 계산만 확인한다).
const px6 = (text: string) => text.length * 6;
const plain = (name: string): NameColumnEntry => ({ name, round: false, memo: false });

test('고객명 열 폭은 완료/취소 슬롯을 항상 포함한다: 이름 61px → dense 61+14+20', () => {
  const measure = () => 61;
  assert.equal(nameColumnWidth([plain('고객')], true, measure), 61 + STATUS_SLOT_DENSE + 20);
  assert.equal(nameColumnWidth([plain('고객')], false, measure), 61 + STATUS_SLOT_FULL + 20);
});

test('완료 여부는 입력에 없으므로 같은 이름 목록이면 항상 같은 폭이다', () => {
  const entries = [plain('통영수산'), plain('거제어시장 본점')];
  assert.equal(nameColumnWidth(entries, true, px6), nameColumnWidth(entries.map((e) => ({ ...e })), true, px6));
});

test('1·2차 배지와 메모 점이 있는 줄은 그만큼 넓어진다', () => {
  const base = nameColumnWidth([plain('가나다라마바사아자차')], true, px6);
  assert.equal(nameColumnWidth([{ name: '가나다라마바사아자차', round: true, memo: false }], true, px6), base + ROUND_BADGE_WIDTH);
  assert.equal(nameColumnWidth([{ name: '가나다라마바사아자차', round: false, memo: true }], true, px6), base + MEMO_DOT_WIDTH);
});

test('가장 넓은 줄을 따른다: 이름이 짧아도 배지·메모가 붙은 줄이 더 넓으면 그 줄 기준', () => {
  const wide = nameColumnWidth([plain('가'.repeat(8)), { name: '가'.repeat(5), round: true, memo: true }], true, px6);
  // 8글자 = 48 + 14 = 62 / 5글자 = 30 + 14 + 28 + 10 = 82
  assert.equal(wide, 82 + 20);
});

test('하한 72·상한 220', () => {
  assert.equal(nameColumnWidth([], true, px6), NAME_COLUMN_MIN);
  assert.equal(nameColumnWidth([plain('가')], true, px6), NAME_COLUMN_MIN);
  assert.equal(nameColumnWidth([plain('가'.repeat(100))], true, px6), NAME_COLUMN_MAX);
  assert.equal(NAME_COLUMN_MAX, 220);
});

test('슬롯 폭: dense는 아이콘 칸 14, 그 외는 글자 배지(완료 46 + 여유)를 덮는다', () => {
  assert.equal(statusSlotWidth(true), 14);
  assert.equal(statusSlotWidth(false), 48);
  // 완료 배지 = 테두리 2 + px-1 8 + 체크 10 + gap 2 + "완료" 20 + mr-1 4
  assert.ok(STATUS_SLOT_FULL >= 2 + 8 + 10 + 2 + 20 + 4);
});

test('터미널 칩 글자: dense는 min(9, 줄−5), 그 외 11', () => {
  assert.equal(terminalChipFontPx(true, 16), 9);
  assert.equal(terminalChipFontPx(true, 15), 9);
  assert.equal(terminalChipFontPx(true, 12), 7);
  assert.equal(terminalChipFontPx(false, 30), 11);
});

test('터미널 열 폭: dense = 글자 + 12 + 2 + 16 + 4(칩 px-1.5), 그 외 = 글자 + 16 + 2 + 16 + 4(칩 px-2)', () => {
  assert.equal(terminalColumnWidth(['x'], true, () => 40), 40 + 34);
  assert.equal(terminalColumnWidth(['x'], false, () => 40), 40 + 38);
  assert.equal(terminalColumnWidth(['a', 'bb'], true, (t) => t.length * 20), 40 + 34); // 가장 긴 이름
});

test('터미널 열 최소 56·최대 120', () => {
  assert.equal(terminalColumnWidth(['-'], true, () => 5), TERMINAL_COLUMN_MIN);
  assert.equal(terminalColumnWidth([], false, px6), TERMINAL_COLUMN_MIN);
  assert.equal(terminalColumnWidth(['x'], true, () => 500), TERMINAL_COLUMN_MAX);
});
