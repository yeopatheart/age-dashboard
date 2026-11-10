import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadedListText, packageCounts, terminalShareList, NO_TERMINAL, SHARE_SAMPLE_CARDS, SHARE_SAMPLE_DATE, SHARE_SAMPLE_TERMINAL, type ShareCard } from './scan-share-text.ts';
import { DEFAULT_SCAN_SHARE_TEMPLATE, type ScanShareTemplate } from './scan-share-template.ts';

const cards: ShareCard[] = [
  { business: '바다횟집', terminal: '대구', packages: { loaded: 3, total: 3 } },
  { business: '해월일식', terminal: '대구', packages: { loaded: 2, total: 4 } },
  { business: '청해수산', terminal: '대구', packages: { loaded: 0, total: 2 } },
  { business: '남해횟집', terminal: '인천', packages: { loaded: 1, total: 1 } },
  { business: '무터미널집', terminal: '', packages: { loaded: 2, total: 2 } },
];
const withTemplate = (over: Partial<ScanShareTemplate>): ScanShareTemplate => ({ ...DEFAULT_SCAN_SHARE_TEMPLATE, ...over });

test('기본 템플릿의 출력은 변수 기능을 넣기 전의 고정 문구와 똑같다', () => {
  assert.equal(
    buildLoadedListText('2026-11-06', cards, '대구'),
    ['11/06(금) 대구 상차 완료', '바다횟집 3박스', '해월일식 2/4박스', '합계 5박스', '⚠ 미상차: 해월일식 2박스 / 청해수산 2박스'].join('\n'),
  );
  assert.equal(buildLoadedListText('2026-11-06', cards, '인천'), ['11/06(금) 인천 상차 완료', '남해횟집 1박스', '합계 1박스'].join('\n'));
  assert.equal(buildLoadedListText('2026-11-06', cards, ''), ['11/06(금) 터미널 없음 상차 완료', '무터미널집 2박스', '합계 2박스'].join('\n'));
});

test('상차된 박스가 하나도 없으면 null이다', () => {
  assert.equal(buildLoadedListText('2026-11-06', [{ business: 'a', terminal: '부산', packages: { loaded: 0, total: 2 } }], '부산'), null);
  assert.equal(buildLoadedListText('2026-11-06', cards, '없는터미널'), null);
});

test('같은 업체의 1·2차는 합산하고 카드 순서대로 처음 나온 순이다', () => {
  const two: ShareCard[] = [
    { business: '가게', terminal: '대구', packages: { loaded: 1, total: 1 } },
    { business: '나게', terminal: '대구', packages: { loaded: 1, total: 1 } },
    { business: '가게', terminal: '대구', packages: { loaded: 1, total: 2 } },
  ];
  assert.equal(buildLoadedListText('2026-11-06', two, '대구'), ['11/06(금) 대구 상차 완료', '가게 2/3박스', '나게 1박스', '합계 3박스', '⚠ 미상차: 가게 1박스'].join('\n'));
});

test('끝에 줄바꿈이나 공백이 남지 않는다', () => {
  for (const tpl of [DEFAULT_SCAN_SHARE_TEMPLATE, withTemplate({ total: '합계 {합계}박스   ' }), withTemplate({ showPending: false })]) {
    const text = buildLoadedListText('2026-11-06', cards, '대구', tpl)!;
    assert.equal(text, text.trim());
    assert.ok(!text.endsWith('\n'));
    assert.ok(!/\n\n/.test(text), '중간에 빈 줄이 없다');
  }
});

test('문구와 변수를 바꾼 템플릿이 적용된다', () => {
  const tpl = withTemplate({ header: '[{터미널명}행] {날짜} 상차 {업체수}곳', line: '- {고객사명} ({상차박스}/{전체박스})', total: '총 {합계}박스 상차했습니다', pending: '남은 곳 → {미상차목록}', dateFormat: 'korean' });
  assert.equal(
    buildLoadedListText('2026-11-06', cards, '대구', tpl),
    ['[대구행] 11월 6일(금) 상차 2곳', '- 바다횟집 (3/3)', '- 해월일식 (2/4)', '총 5박스 상차했습니다', '남은 곳 → 해월일식 2박스 / 청해수산 2박스'].join('\n'),
  );
});

test('미상차 줄을 끄면 미상차가 있어도 넣지 않는다', () => {
  const text = buildLoadedListText('2026-11-06', cards, '대구', withTemplate({ showPending: false }))!;
  assert.ok(!text.includes('미상차'));
});

test('비워 둔 줄은 글에서 빠진다(첫 줄·합계 줄 없애기)', () => {
  assert.equal(buildLoadedListText('2026-11-06', cards, '인천', withTemplate({ header: '', total: '' })), '남해횟집 1박스');
});

test('설정 화면 미리보기용 예시 데이터는 모두 상차·일부 상차·미상차를 한 번에 보여 준다', () => {
  const text = buildLoadedListText(SHARE_SAMPLE_DATE, SHARE_SAMPLE_CARDS, SHARE_SAMPLE_TERMINAL)!;
  assert.match(text, /바다횟집 3박스/);
  assert.match(text, /해월일식 2\/4박스/);
  assert.match(text, /⚠ 미상차: 해월일식 2박스 \/ 청해수산 2박스/);
});

test('합포장 묶음은 한 덩이로 센다', () => {
  assert.deepEqual(
    packageCounts(
      [
        { seq: 1, loaded: true },
        { seq: 2, loaded: true },
        { seq: 3, loaded: false },
      ],
      [[1, 2]],
    ),
    { loaded: 1, total: 2 },
  );
});

test('터미널별 목록은 처음 나온 순서이고 상차/전체 박스를 합산하며 상차 0박스면 글이 null이다', () => {
  const cards = [
    { business: 'A', terminal: '대구', loaded: 2, total: 2, packages: { loaded: 2, total: 2 } },
    { business: 'B', terminal: '', loaded: 0, total: 1, packages: { loaded: 0, total: 1 } },
    { business: 'C', terminal: '대구', loaded: 1, total: 3, packages: { loaded: 1, total: 3 } },
  ];
  const list = terminalShareList('2026-11-06', cards);
  assert.deepEqual(list.map((t) => [t.name, t.loaded, t.total]), [['대구', 3, 5], [NO_TERMINAL, 0, 1]]);
  assert.equal(list[0].text, buildLoadedListText('2026-11-06', cards, '대구'));
  assert.equal(list[1].text, null);
  assert.deepEqual(terminalShareList('2026-11-06', []), []);
});
