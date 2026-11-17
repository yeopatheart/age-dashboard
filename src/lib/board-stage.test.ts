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

// 예전 규칙(2026-11-17 이전: 주문 수에 따라 단계·줄 수가 바뀌던 계산)을 그대로 옮긴 것. 새 규칙에서 이것과 같아야 하는 곳은 "고정 규칙이 못 쓰는 경우"(화면이 너무 낮을 때)와
// 전체 보기·휴대폰뿐이다. 두 모니터가 같은 높이·줄 수라 모니터 2 시작 = capacity다.
function legacyLayout(rowCount: number, availHeight: number) {
  const tier = ROW_HEIGHT_TIERS.find((h) => 2 * Math.floor(availHeight / h) >= rowCount) ?? MIN_ROW_HEIGHT;
  const { rowHeight, capacity } = fitRowHeight(availHeight, tier, tier >= 30 ? 30 : MIN_ROW_HEIGHT, 6);
  return { rowHeight, capacity, monitor2Start: capacity };
}

const INITIAL = 35; // dashboard-client의 INITIAL_ROW_CAPACITY와 같은 값
const AVAIL = 606; // 칠판 본문 높이(상단·표 머리를 줄이기 전)
const AVAIL_SLIM = 634; // 상단·표 머리를 줄인 뒤의 본문 높이(추정)
const layoutAt = (n: number, avail = AVAIL, monitor = '1') => rowLayout(n, avail, INITIAL, 6, true, monitor);
const monitor2At = (n: number, avail = AVAIL) => layoutAt(n, avail, '2');
// dashboard-client: 모니터 1 = 앞 capacity개, 모니터 2 = monitor2Start부터 capacity개
const monitor1Rows = (n: number, avail = AVAIL) => Array.from({ length: n }, (_, i) => i + 1).slice(0, layoutAt(n, avail).capacity);
const monitor2Rows = (n: number, avail = AVAIL) => {
  const l = monitor2At(n, avail);
  return Array.from({ length: n }, (_, i) => i + 1).slice(l.monitor2Start, l.monitor2Start + l.capacity);
};
// 71건 이상 모니터 2의 기대값: 36번째부터 n = 주문 수 − 35줄을 담도록 줄 높이를 줄인다(15px 아래로는 안 줄인다).
const expectedMonitor2 = (rowCount: number, avail: number) => {
  const rowHeight = Math.min(Math.floor(avail / 35), 40, Math.max(15, Math.floor(avail / (rowCount - 35))));
  return { rowHeight, capacity: Math.floor(avail / rowHeight), monitor2Start: 35 };
};

// 2026-11-17: 예전에는 "40건 이하에서 예전 규칙과 같다"를 고정했다(배포 순간 칠판의 줄 위치가 바뀌지 않게). 그 규칙은 주문 수에 따라 모니터 경계가 움직여
// (54→55건에서 28→31줄) 모니터 2의 줄이 모니터 1로 넘어가면 필기가 따라가지 못했다. 그래서 경계를 고정하는 새 규칙으로 바꿨고, 아래가 그 규칙을 고정한다.
test('전체 보기·휴대폰(fixedBoundary=false)은 모니터 경계가 없으므로 어떤 주문 수·화면 높이에서도 예전 규칙과 같다', () => {
  for (const avail of [0, 400, 555, 560, 606, 634, 650, 700, 900]) {
    for (let n = 0; n <= 100; n++) {
      for (const monitor of ['1', '2', 'all']) {
        const got = rowLayout(n, avail, INITIAL, 6, false, monitor);
        if (!(avail > 0)) assert.deepEqual(got, { rowHeight: ROW_HEIGHT_TIERS[0], capacity: INITIAL, monitor2Start: INITIAL }, `avail ${avail}, rows ${n}`);
        else assert.deepEqual(got, legacyLayout(n, avail), `avail ${avail}, rows ${n}, monitor ${monitor}`);
      }
    }
  }
});

test('주문 1~70건은 두 모니터 모두 35줄이고, 줄 높이는 본문 606px에서 17px·634px에서 18px(주문 수와 무관하게 같다)', () => {
  for (let n = 1; n <= 70; n++) {
    for (const monitor of ['1', '2']) {
      assert.deepEqual(layoutAt(n, 606, monitor), { rowHeight: 17, capacity: 35, monitor2Start: 35 }, `606px, rows ${n}, monitor ${monitor}`);
      assert.deepEqual(layoutAt(n, 634, monitor), { rowHeight: 18, capacity: 35, monitor2Start: 35 }, `634px, rows ${n}, monitor ${monitor}`);
    }
  }
});

test('모니터 1은 주문 수와 무관하게 1~35번째이고 모니터 2는 어떤 주문 수에서도 36번째부터다(핵심 불변식, 1~200건)', () => {
  for (const avail of [AVAIL, AVAIL_SLIM]) {
    const base = layoutAt(1, avail); // 70건 이하의 값
    for (let n = 1; n <= 200; n++) {
      assert.deepEqual(layoutAt(n, avail), base, `avail ${avail}, rows ${n}: 모니터 1 결과가 70건 이하와 같다`);
      assert.deepEqual(monitor1Rows(n, avail), Array.from({ length: Math.min(n, 35) }, (_, i) => i + 1), `avail ${avail}, rows ${n}: 모니터 1`);
      assert.equal(monitor2At(n, avail).monitor2Start, 35, `avail ${avail}, rows ${n}`);
      const m2 = monitor2Rows(n, avail);
      if (n > 35) assert.equal(m2[0], 36, `avail ${avail}, rows ${n}: 모니터 2는 36번째부터`);
    }
  }
});

test('주문 71건 이상 모니터 2는 36번째부터 나머지 전부를 담도록 줄 높이만 줄어든다(606px: 71건 16px … 75건 15px, 634px: 71건 17px … 77건 15px)', () => {
  for (const avail of [AVAIL, AVAIL_SLIM]) {
    for (let n = 71; n <= 200; n++) assert.deepEqual(monitor2At(n, avail), expectedMonitor2(n, avail), `avail ${avail}, rows ${n}`);
  }
  assert.deepEqual(monitor2At(71, 606), { rowHeight: 16, capacity: 37, monitor2Start: 35 }); // n=36 → floor(606/36)=16
  assert.deepEqual(monitor2At(75, 606), { rowHeight: 15, capacity: 40, monitor2Start: 35 }); // n=40 → floor(606/40)=15
  assert.deepEqual(monitor2At(71, 634), { rowHeight: 17, capacity: 37, monitor2Start: 35 }); // n=36 → floor(634/36)=17
  assert.deepEqual(monitor2At(77, 634), { rowHeight: 15, capacity: 42, monitor2Start: 35 }); // n=42 → floor(634/42)=15
  for (const avail of [AVAIL, AVAIL_SLIM]) {
    // 주문이 늘수록 모니터 2의 줄 높이는 줄기만 하고, 15px 아래로 내려가지 않으며, 줄 칸이 본문을 넘지 않는다.
    for (let n = 71; n <= 200; n++) {
      const l = monitor2At(n, avail);
      assert.ok(l.rowHeight >= 15 && l.rowHeight <= monitor2At(n - 1, avail).rowHeight, `avail ${avail}, rows ${n}`);
      assert.ok(l.capacity * l.rowHeight <= avail, `avail ${avail}, rows ${n}: 줄이 본문을 넘는다`);
    }
  }
});

// 설명 테스트: 71건부터 무엇이 달라지는지를 눈에 보이게 고정한다. 줄이 모니터 1로 넘어가면 필기가 따라오지 못해서 모니터 1은 건드리지 않는다.
test('71건부터 모니터 1은 안 바뀌고 모니터 2만 줄 높이가 17→16→…→15px로 내려간다(606px)', () => {
  const heights2: number[] = [];
  for (let n = 70; n <= 75; n++) {
    assert.deepEqual(layoutAt(n), { rowHeight: 17, capacity: 35, monitor2Start: 35 }, `rows ${n}: 모니터 1`);
    assert.deepEqual(monitor1Rows(n), Array.from({ length: 35 }, (_, i) => i + 1), `rows ${n}: 모니터 1 줄`);
    assert.deepEqual(monitor2Rows(n).slice(0, n - 35), Array.from({ length: n - 35 }, (_, i) => i + 36), `rows ${n}: 모니터 2는 36번부터 끝까지`);
    heights2.push(monitor2At(n).rowHeight);
  }
  assert.deepEqual(heights2, [17, 16, 16, 15, 15, 15]);
});

test('hiddenRowCount: 모니터 2에 15px로도 다 못 담는 주문만 센다(606px는 76건부터, 634px는 78건부터), 모니터 1에서는 세지 않는다', () => {
  const hidden = (n: number, avail: number, mode = '2') => {
    const l = layoutAt(n, avail, mode);
    return hiddenRowCount(mode, n, l.monitor2Start, l.capacity);
  };
  for (const [avail, first] of [[AVAIL, 76], [AVAIL_SLIM, 78]] as const) {
    for (let n = 0; n < first; n++) assert.equal(hidden(n, avail), 0, `avail ${avail}, rows ${n}`);
    assert.equal(hidden(first, avail), 1, `avail ${avail}`);
    assert.equal(hidden(100, avail), 100 - first + 1, `avail ${avail}`);
    assert.equal(hidden(100, avail, '1'), 0); // 모니터 1에서는 세지 않는다
    assert.equal(hiddenRowCount('all', 100, 35, 35), 0);
  }
  // 숨는 주문이 없는 범위에서는 모든 주문이 두 모니터 중 하나에 그려진다.
  for (const [avail, last] of [[AVAIL, 75], [AVAIL_SLIM, 77]] as const) {
    for (let n = 1; n <= last; n++) assert.deepEqual([...monitor1Rows(n, avail), ...monitor2Rows(n, avail)], Array.from({ length: n }, (_, i) => i + 1), `avail ${avail}, rows ${n}`);
  }
});

test('본문 높이 525~700px 어디서나 모니터 1은 35줄·floor(본문/35)px이고, 71건 이상의 모니터 2만 위 규칙으로 줄어든다', () => {
  for (let avail = 525; avail <= 700; avail++) {
    const h1 = Math.floor(avail / 35);
    assert.ok(h1 >= 15 && h1 <= 40, `avail ${avail}: ${h1}`);
    for (let n = 0; n <= 200; n++) {
      assert.deepEqual(layoutAt(n, avail), { rowHeight: h1, capacity: 35, monitor2Start: 35 }, `avail ${avail}, rows ${n}: 모니터 1`);
      if (n <= 70) assert.deepEqual(monitor2At(n, avail), layoutAt(n, avail), `avail ${avail}, rows ${n}: 모니터 2`);
      else assert.deepEqual(monitor2At(n, avail), expectedMonitor2(n, avail), `avail ${avail}, rows ${n}: 모니터 2`);
    }
  }
});

test('줄 높이는 위쪽 40px로 제한되고(아주 높은 화면), 줄 수는 정수·1 이상이다', () => {
  assert.deepEqual(layoutAt(10, 5000), { rowHeight: 40, capacity: 35, monitor2Start: 35 });
  for (let avail = 1; avail <= 3000; avail += 7) {
    for (const n of [0, 1, 30, 70, 71, 75, 80, 81, 200]) {
      for (const monitor of ['1', '2']) {
        const l = layoutAt(n, avail, monitor);
        assert.ok(Number.isInteger(l.capacity) && l.capacity >= 1, `avail ${avail}, rows ${n}: capacity ${l.capacity}`);
        assert.ok(Number.isInteger(l.monitor2Start) && l.monitor2Start >= 1, `avail ${avail}, rows ${n}: monitor2Start ${l.monitor2Start}`);
        assert.ok(Number.isInteger(l.rowHeight) && l.rowHeight > 0 && l.rowHeight <= 40, `avail ${avail}, rows ${n}: height ${l.rowHeight}`);
      }
    }
  }
});

test('고정 규칙을 못 쓰는 낮은 화면(본문 525px 미만, 35줄이 15px 미만)은 주문 수·모니터와 관계없이 예전 규칙으로 되돌아간다', () => {
  for (let avail = 1; avail < 35 * 15; avail++) {
    for (const n of [0, 1, 35, 70, 71, 75, 80, 100, 200]) {
      for (const monitor of ['1', '2']) assert.deepEqual(layoutAt(n, avail, monitor), legacyLayout(n, avail), `avail ${avail}, rows ${n}, monitor ${monitor}`);
    }
  }
  // 경계: 525px부터는 고정 규칙이다.
  assert.deepEqual(layoutAt(70, 525), { rowHeight: 15, capacity: 35, monitor2Start: 35 });
  assert.deepEqual(monitor2At(71, 525), { rowHeight: 15, capacity: 35, monitor2Start: 35 });
});

test('본문 높이를 아직 못 쟀으면(0 이하) 임시값(줄 수 35)을 쓴다', () => {
  for (const avail of [0, -5, NaN]) {
    for (const monitor of ['1', '2']) assert.deepEqual(layoutAt(50, avail, monitor), { rowHeight: 40, capacity: 35, monitor2Start: 35 });
  }
  assert.equal(layoutAt(50, 0).capacity, layoutAt(50, AVAIL).capacity); // 첫 렌더와 측정 뒤의 경계가 같다
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
  assert.equal(hiddenRowCount('1', 34, 19, 19), 0); // 11/16 사진: 34줄 중 19줄이 모니터 1, 15줄은 모니터 2에 정상
  assert.equal(hiddenRowCount('2', 34, 19, 19), 0);
  assert.equal(hiddenRowCount('2', 41, 20, 20), 1);
  assert.equal(hiddenRowCount('2', 50, 20, 20), 10);
  assert.equal(hiddenRowCount('all', 50, 20, 20), 0);
});
