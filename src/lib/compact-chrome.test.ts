import test from 'node:test';
import assert from 'node:assert/strict';
import { CHROME_COMPACT, CHROME_FULL, chromeFor, estimateAvailHeight, headerHeight, toolbarHeight, type ChromeMetrics } from './compact-chrome.ts';
import { STAGE_H } from './board-stage.ts';
import { rowLayout } from './monitor-rows.ts';

test('FULL은 PR-B 이전 높이 그대로다: 도구줄 50, 표 머리 30, 줄 영역 606(전체 보기·휴대폰은 안 바뀐다)', () => {
  assert.equal(toolbarHeight(CHROME_FULL), 50);
  assert.equal(headerHeight(CHROME_FULL), 30);
  assert.equal(estimateAvailHeight(STAGE_H, CHROME_FULL), 606);
});

test('COMPACT: 도구줄 36, 표 머리 20, 줄 영역 634(+28)', () => {
  assert.equal(toolbarHeight(CHROME_COMPACT), 36);
  assert.equal(headerHeight(CHROME_COMPACT), 20);
  assert.equal(estimateAvailHeight(STAGE_H, CHROME_COMPACT), 634);
  assert.equal(estimateAvailHeight(STAGE_H, CHROME_COMPACT) - estimateAvailHeight(STAGE_H, CHROME_FULL), 28);
});

test('모니터 1·2(split)만 줄인다', () => {
  assert.equal(chromeFor(true), CHROME_COMPACT);
  assert.equal(chromeFor(false), CHROME_FULL);
});

// Tailwind 단위(1 = 4px)나 [Npx] 표기를 px로 바꾼다. 숫자와 클래스가 같은 값을 가리키는지 확인해, 한쪽만 고쳐서 어긋나는 일을 막는다.
function tw(cls: string, prefix: string): number {
  const m = new RegExp(`(?:^| )${prefix}-(?:\\[(\\d+)px\\]|([\\d.]+))(?: |$)`).exec(cls);
  assert.ok(m, `${cls}에서 ${prefix}-값을 못 찾음`);
  return m[1] !== undefined ? Number(m[1]) : Number(m[2]) * 4;
}

for (const [name, m] of [['FULL', CHROME_FULL], ['COMPACT', CHROME_COMPACT]] as [string, ChromeMetrics][]) {
  test(`${name}: 클래스가 숫자와 일치한다`, () => {
    assert.equal(tw(m.ctlH, 'h'), m.ctl);
    assert.equal(tw(m.sq, 'h'), m.ctl);
    assert.equal(tw(m.sq, 'w'), m.ctl);
    assert.equal(tw(m.bar, 'py'), m.barPadY);
    assert.equal(tw(m.headCell, 'py'), m.headPadY);
    assert.equal(tw(m.gap, 'gap'), m.pageGap);
    assert.equal(tw(m.menuTop, 'top'), m.ctl + 8, '드롭다운은 버튼 아래 8px에 뜬다');
    assert.equal(m.chipSteps[0][0], m.chipFs);
  });
}

test('COMPACT 하한: 터치 대상 28px 이상, 표 머리·칩 기본 글자 11px 이상, 줄 높이 14px 이상', () => {
  assert.ok(CHROME_COMPACT.ctl >= 28);
  assert.match(CHROME_COMPACT.headText, /text-\[11px\]/);
  assert.match(CHROME_COMPACT.headText, /leading-\[14px\]/);
  assert.ok(CHROME_COMPACT.headLine >= 14);
  assert.ok(CHROME_COMPACT.chipFs >= 11);
  assert.ok(CHROME_COMPACT.chipSteps.slice(0, 2).every(([fs]) => fs >= 11), '11px 아래 단계는 폭이 모자랄 때의 폴백뿐이다');
  assert.equal(CHROME_COMPACT.date.includes('h-7'), true, '날짜 칸 높이는 버튼과 같다');
});

test('칩은 버튼 높이를 넘지 않는다(도구줄 높이를 버튼이 정한다)', () => {
  // 칩 높이 = 글자 줄 높이(body 1.5배) + 위·아래 여백 + 테두리 2
  for (const m of [CHROME_FULL, CHROME_COMPACT]) {
    const chip = Math.ceil(m.chipFs * 1.5) + 2 * m.chipPadY + 2;
    assert.ok(chip <= m.ctl, `칩 ${chip}px > 버튼 ${m.ctl}px`);
  }
});

test('줄 높이 효과: 줄 영역 606→634에서 37줄 16→17px, 40줄은 15px 그대로, 경계(줄 수)는 안 바뀐다', () => {
  const fixed = (avail: number, rows: number) => rowLayout(rows, avail, 37, 6, true);
  assert.deepEqual(fixed(606, 60), { rowHeight: 16, capacity: 37 });
  assert.deepEqual(fixed(634, 60), { rowHeight: 17, capacity: 37 });
  assert.deepEqual(fixed(606, 78), { rowHeight: 15, capacity: 40 });
  assert.deepEqual(fixed(634, 78), { rowHeight: 15, capacity: 40 });
  for (const n of [1, 37, 38, 74, 75, 80]) assert.equal(fixed(634, n).capacity, fixed(606, n).capacity);
  // 이후 35줄 규칙으로 바뀔 경우의 계산(규칙은 이 PR 범위 밖): floor(줄 영역 / 35)
  assert.equal(Math.floor(606 / 35), 17);
  assert.equal(Math.floor(634 / 35), 18);
});
