import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_H, STAGE_W, stageLayout } from './board-stage.ts';
import { hiddenRowCount, MIN_ROW_HEIGHT, ROW_HEIGHT_TIERS, rowLayout } from './monitor-rows.ts';
import { fitRowHeight } from './row-fit.ts';
import { anchorLegacyStrokes, pickRowAnchor, rowAnchor } from './ink/row-anchor.ts';
import { resolvePoints, toAnchoredStroke, toFreeStroke, type Box, type InkStroke } from './ink/store.ts';

test('칠판 크기(기준 크기)는 배율 없이 바깥 영역을 그대로 채운다', () => {
  const l = stageLayout(STAGE_W, STAGE_H);
  assert.equal(l.native, true);
  assert.equal(l.scale, 1);
  assert.equal(l.width, STAGE_W);
  assert.equal(l.height, STAGE_H);
});

test('칠판 브라우저가 어긋나도(±6%, 추정 높이 667~701px 포함) 기준 크기로 본다', () => {
  for (const h of [667, 680, 701, 720]) assert.equal(stageLayout(STAGE_W, h).native, true, `높이 ${h}`);
  const l = stageLayout(STAGE_W - 20, STAGE_H - 12);
  assert.equal(l.native, true);
  assert.equal(l.width, STAGE_W - 20); // 변환 없이 바깥 영역을 채운다
});

test('칠판에서 사이드바를 펼쳐 폭이 줄어도(약 84%) 칠판으로 본다: 줄 나눔이 같고 펜이 막히지 않는다', () => {
  const l = stageLayout(1050, STAGE_H);
  assert.equal(l.native, true);
  assert.equal(l.width, 1050);
  assert.equal(stageLayout(900, STAGE_H).native, false, '폭이 75% 미만이면 축소 화면');
});

test('큰 창은 기준 화면을 비율을 지키며 확대하고 가로 가운데에 둔다', () => {
  const l = stageLayout(1980, 1200);
  assert.equal(l.native, false);
  assert.ok(Math.abs(l.scale - 1980 / STAGE_W) < 1e-9, '가로가 더 빡빡하다');
  assert.equal(l.width, STAGE_W);
  assert.equal(l.height, STAGE_H);
  assert.equal(l.left, 0);
  const tall = stageLayout(1400, 1200);
  assert.ok(Math.abs(tall.scale - 1400 / STAGE_W) < 1e-9);
  const wide = stageLayout(2400, 900);
  assert.ok(Math.abs(wide.scale - 900 / STAGE_H) < 1e-9, '세로가 더 빡빡하면 세로 기준');
  assert.ok(wide.left > 0, '남는 가로는 양쪽 여백');
});

test('작은 창은 축소한다', () => {
  const l = stageLayout(1000, 560);
  assert.equal(l.native, false);
  assert.ok(l.scale < 1);
});

test('크기를 아직 못 쟀으면(0) 변환하지 않는다', () => {
  assert.equal(stageLayout(0, 0).native, true);
});

// 예전 규칙(2026-11-17 이전: 주문 수에 따라 단계·줄 수가 바뀌던 계산)을 그대로 옮긴 것. 새 규칙에서 이것과 같아야 하는 곳은 "고정 규칙이 못 쓰는 경우"(화면이 너무 낮을 때, 주문 81건 이상)뿐이다.
function legacyLayout(rowCount: number, availHeight: number) {
  const tier = ROW_HEIGHT_TIERS.find((h) => 2 * Math.floor(availHeight / h) >= rowCount) ?? MIN_ROW_HEIGHT;
  return fitRowHeight(availHeight, tier, tier >= 30 ? 30 : MIN_ROW_HEIGHT, 6);
}

const INITIAL = 37; // dashboard-client의 INITIAL_ROW_CAPACITY와 같은 값
const AVAIL = 606; // 칠판 본문 높이
const layoutAt = (n: number, avail = AVAIL) => rowLayout(n, avail, INITIAL, 6);

// 2026-11-17: 예전에는 "40건 이하에서 예전 규칙과 같다"를 고정했다(배포 순간 칠판의 줄 위치가 바뀌지 않게). 그 규칙은 주문 수에 따라 모니터 경계가 움직여
// (54→55건에서 28→31줄) 모니터 2의 줄이 모니터 1로 넘어가면 필기가 따라가지 못했다. 그래서 경계를 고정하는 새 규칙으로 바꿨고, 아래가 그 규칙을 고정한다.
test('전체 보기·휴대폰(fixedBoundary=false)은 모니터 경계가 없으므로 어떤 주문 수·화면 높이에서도 예전 규칙과 같다', () => {
  for (const avail of [0, 400, 555, 560, 606, 650, 700, 900]) {
    for (let n = 0; n <= 100; n++) {
      const got = rowLayout(n, avail, INITIAL, 6, false);
      if (!(avail > 0)) assert.deepEqual(got, { rowHeight: ROW_HEIGHT_TIERS[0], capacity: INITIAL }, `avail ${avail}, rows ${n}`);
      else assert.deepEqual(got, legacyLayout(n, avail), `avail ${avail}, rows ${n}`);
    }
  }
});

test('칠판(606px): 주문 1~74건은 전부 모니터당 37줄·16px(주문 수와 무관하게 같다)', () => {
  for (let n = 1; n <= 74; n++) assert.deepEqual(layoutAt(n), { rowHeight: 16, capacity: 37 }, `rows ${n}`);
});

test('주문 1~74건 어디서나 모니터 1은 1~37번째, 모니터 2는 38번째부터다(경계 불변)', () => {
  const boundary = (n: number) => layoutAt(n).capacity; // dashboard-client: 모니터 2 시작 = capacity, 모니터 1 = 앞 capacity개
  for (let n = 1; n <= 74; n++) {
    const rowsAll = Array.from({ length: n }, (_, i) => i + 1);
    const cap = boundary(n);
    assert.deepEqual(rowsAll.slice(0, cap), rowsAll.filter((x) => x <= 37), `rows ${n}: 모니터 1`);
    assert.deepEqual(rowsAll.slice(cap, cap + cap), rowsAll.filter((x) => x >= 38), `rows ${n}: 모니터 2`);
  }
});

test('주문 75~80건은 전부 모니터당 40줄·15px, 74→75건에서 경계가 37→40으로 딱 한 번 바뀐다', () => {
  for (let n = 75; n <= 80; n++) assert.deepEqual(layoutAt(n), { rowHeight: 15, capacity: 40 }, `rows ${n}`);
  const changes: number[] = [];
  for (let n = 2; n <= 80; n++) if (layoutAt(n).capacity !== layoutAt(n - 1).capacity) changes.push(n);
  assert.deepEqual(changes, [75]);
  assert.equal(layoutAt(74).capacity, 37);
  assert.equal(layoutAt(75).capacity, 40);
  for (let n = 75; n <= 80; n++) assert.equal(hiddenRowCount('2', n, layoutAt(n).capacity), 0, `rows ${n}`);
});

test('주문 81건 이상은 가장 촘촘한 줄(15px)로 일부가 안 보인다(hiddenRowCount가 센다)', () => {
  for (const n of [81, 100]) {
    const l = layoutAt(n);
    assert.deepEqual(l, { rowHeight: 15, capacity: 40 }, `rows ${n}`);
    assert.deepEqual(l, legacyLayout(n, AVAIL), `rows ${n}: 81건 이상은 예전 규칙 그대로`);
  }
  assert.equal(hiddenRowCount('2', 81, layoutAt(81).capacity), 1);
  assert.equal(hiddenRowCount('2', 100, layoutAt(100).capacity), 20);
  assert.equal(hiddenRowCount('1', 100, layoutAt(100).capacity), 0); // 모니터 1에서는 세지 않는다
});

test('본문 높이 560~700px 어디서나 모니터 1 줄 수는 주문 수 구간별로 고정이고 줄 높이는 15~40의 정수다', () => {
  for (let avail = 560; avail <= 700; avail++) {
    for (let n = 0; n <= 74; n++) {
      const l = layoutAt(n, avail);
      // 15px 이상으로 40줄이 안 들어가는 560~599px의 75~80건은 폴백이므로 아래에서 따로 본다.
      assert.equal(l.capacity, 37, `avail ${avail}, rows ${n}`);
      assert.equal(l.rowHeight, Math.floor(avail / 37), `avail ${avail}, rows ${n}`);
      assert.ok(Number.isInteger(l.rowHeight) && l.rowHeight >= 15 && l.rowHeight <= 40, `avail ${avail}: ${l.rowHeight}`);
    }
    if (avail >= 600) {
      for (let n = 75; n <= 80; n++) {
        const l = layoutAt(n, avail);
        assert.equal(l.capacity, 40, `avail ${avail}, rows ${n}`);
        assert.equal(l.rowHeight, Math.floor(avail / 40), `avail ${avail}, rows ${n}`);
        assert.ok(Number.isInteger(l.rowHeight) && l.rowHeight >= 15 && l.rowHeight <= 40);
      }
    }
  }
});

test('줄 높이는 위쪽 40px로 제한되고(아주 높은 화면), 줄 수는 정수·1 이상이다', () => {
  assert.deepEqual(layoutAt(10, 5000), { rowHeight: 40, capacity: 37 });
  for (let avail = 1; avail <= 3000; avail += 7) {
    for (const n of [0, 1, 30, 74, 75, 80, 81, 200]) {
      const l = layoutAt(n, avail);
      assert.ok(Number.isInteger(l.capacity) && l.capacity >= 1, `avail ${avail}, rows ${n}: capacity ${l.capacity}`);
      assert.ok(Number.isInteger(l.rowHeight) && l.rowHeight > 0 && l.rowHeight <= 40, `avail ${avail}, rows ${n}: height ${l.rowHeight}`);
    }
  }
});

test('고정 규칙의 줄 높이가 15px 미만이면(화면이 너무 낮음) 예전 규칙으로 되돌아간다', () => {
  for (let avail = 1; avail < 37 * 15; avail++) {
    for (let n = 0; n <= 74; n++) assert.deepEqual(layoutAt(n, avail), legacyLayout(n, avail), `avail ${avail}, rows ${n}`);
  }
  for (let avail = 1; avail < 40 * 15; avail++) {
    for (let n = 75; n <= 80; n++) assert.deepEqual(layoutAt(n, avail), legacyLayout(n, avail), `avail ${avail}, rows ${n}`);
  }
});

test('본문 높이를 아직 못 쟀으면(0 이하) 임시값(줄 수 37)을 쓴다', () => {
  for (const avail of [0, -5, NaN]) assert.deepEqual(layoutAt(50, avail), { rowHeight: 40, capacity: 37 });
  assert.equal(layoutAt(50, 0).capacity, layoutAt(50, AVAIL).capacity); // 첫 렌더와 측정 뒤의 경계가 같다
});

test('2026-11-17: 칠판(본문 606px)에서 주문 41~80건도 두 모니터에 다 들어간다(예전엔 40건 초과가 안 보임)', () => {
  for (let n = 41; n <= 80; n++) {
    const l = layoutAt(n);
    assert.ok(2 * l.capacity >= n, `rows ${n}: capacity ${l.capacity}`);
    assert.ok(l.rowHeight >= 15 && l.rowHeight < 30, `rows ${n}: height ${l.rowHeight}`);
    assert.ok(l.capacity * l.rowHeight <= 606, `rows ${n}: 줄이 본문을 넘는다`);
    assert.equal(hiddenRowCount('2', n, l.capacity), 0);
  }
  assert.equal(hiddenRowCount('2', 81, layoutAt(81).capacity), 1);
  assert.equal(layoutAt(80).rowHeight, 15);
});

const rows = new Map<string, Box>([
  [rowAnchor('a'), { left: 0, top: 0, width: 1000, height: 35 }],
  [rowAnchor('b'), { left: 0, top: 35, width: 1000, height: 35 }],
  ['chip-1', { left: 300, top: 5, width: 100, height: 25 }],
]);

test('획은 평균 위치가 들어 있는 줄에 붙는다(상품 칸은 줄로 보지 않는다)', () => {
  assert.equal(pickRowAnchor([{ x: 310, y: 10 }, { x: 320, y: 20 }], rows), rowAnchor('a'));
  assert.equal(pickRowAnchor([{ x: 310, y: 45 }, { x: 320, y: 60 }], rows), rowAnchor('b'));
  assert.equal(pickRowAnchor([{ x: 10, y: 300 }, { x: 20, y: 310 }], rows), null);
});

test('평균이 줄 밖이면 시작점이 있는 줄에 붙는다', () => {
  assert.equal(pickRowAnchor([{ x: 10, y: 30 }, { x: 10, y: 400 }], rows), rowAnchor('a'));
});

test('줄에 붙인 획은 줄 높이가 바뀌어도 같은 줄 안의 같은 비율 위치에 그려진다', () => {
  const pts = [{ x: 500, y: 10 }, { x: 520, y: 20 }];
  const stroke = toAnchoredStroke({ id: 's', color: '#dc2626', width: 3 }, pts, rowAnchor('a'), rows.get(rowAnchor('a')) as Box);
  const taller: Box = { left: 0, top: 70, width: 1000, height: 70 }; // 줄이 아래로 밀리고 두 배로 커졌다
  const out = resolvePoints(stroke, { width: 1248, height: 696 }, taller);
  assert.ok(out);
  assert.ok(Math.abs((out?.[0].y ?? 0) - (70 + 10 * 2)) < 0.2); // 저장은 소수 넷째 자리까지라 0.1px 안쪽 오차
  assert.ok(Math.abs((out?.[1].y ?? 0) - (70 + 20 * 2)) < 0.2);
});

test('줄 밖으로 삐져나간 획도 줄 비율로 저장돼서 줄을 따라간다', () => {
  const pts = [{ x: 500, y: 30 }, { x: 520, y: 50 }]; // 줄 a를 넘어 b로 걸친다
  const stroke = toAnchoredStroke({ id: 's', color: '#dc2626', width: 3 }, pts, rowAnchor('a'), rows.get(rowAnchor('a')) as Box);
  const moved: Box = { left: 0, top: 100, width: 1000, height: 35 };
  const out = resolvePoints(stroke, { width: 1248, height: 696 }, moved);
  assert.ok(Math.abs((out?.[1].y ?? 0) - (100 + 50)) < 0.2);
});

test('예전 방식(그림 층 비율) 획은 지금 보이는 위치 그대로 줄에 붙고, 줄 밖 획은 그대로 둔다', () => {
  const layer = { width: 1248, height: 696 };
  const inRow: InkStroke = toFreeStroke({ id: 'old1', color: '#dc2626', width: 3 }, [{ x: 600, y: 40 }, { x: 650, y: 55 }], layer);
  const outside: InkStroke = toFreeStroke({ id: 'old2', color: '#dc2626', width: 3 }, [{ x: 600, y: 400 }, { x: 650, y: 420 }], layer);
  const already: InkStroke = { id: 'chip', color: '#dc2626', width: 3, pts: [0.1, 0.1, 0.2, 0.2], anchor: 'chip-1' };
  const out = anchorLegacyStrokes([inRow, outside, already], layer, rows);
  assert.equal(out[0].anchor, rowAnchor('b'));
  assert.equal(out[0].id, 'old1');
  assert.equal(out[1].anchor, undefined);
  assert.equal(out[2], already);
  // 붙이기 전후로 화면 위 위치가 같다(저장 방식만 바뀐다)
  const before = resolvePoints(inRow, layer);
  const after = resolvePoints(out[0], layer, rows.get(rowAnchor('b')) as Box);
  assert.ok(before && after);
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(before[i].x - after[i].x) < 0.2);
    assert.ok(Math.abs(before[i].y - after[i].y) < 0.2);
  }
});

test('붙일 것이 없으면 같은 배열을 돌려준다(불필요한 저장을 막는다)', () => {
  const layer = { width: 1248, height: 696 };
  const outside: InkStroke = toFreeStroke({ id: 'o', color: '#dc2626', width: 3 }, [{ x: 600, y: 400 }, { x: 650, y: 420 }], layer);
  const list = [outside];
  assert.equal(anchorLegacyStrokes(list, layer, rows), list);
});

test('"안 보임" 표시는 모니터 2에서 두 모니터에 다 못 담는 줄만 센다(모니터 1에서 모니터 2로 넘어간 줄은 세지 않는다)', () => {
  assert.equal(hiddenRowCount('1', 34, 19), 0); // 11/16 사진: 34줄 중 19줄이 모니터 1, 15줄은 모니터 2에 정상
  assert.equal(hiddenRowCount('2', 34, 19), 0);
  assert.equal(hiddenRowCount('2', 41, 20), 1);
  assert.equal(hiddenRowCount('2', 50, 20), 10);
  assert.equal(hiddenRowCount('all', 50, 20), 0);
});
