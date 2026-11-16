import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_H, STAGE_W, stageLayout } from './board-stage.ts';
import { hiddenRowCount, rowLayout } from './monitor-rows.ts';
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

// 예전 코드(배포 전 main)의 줄 높이 계산을 그대로 옮긴 것. 새 계산이 이것과 모든 주문 수·높이에서 같아야 배포 순간 칠판의 줄 위치가 바뀌지 않는다.
function legacyLayout(rowCount: number, availHeight: number) {
  const tiers = [40, 36, 32, 30];
  const tierHeight = availHeight > 0 ? tiers.find((h) => 2 * Math.floor(availHeight / h) >= rowCount) ?? 30 : tiers[0];
  return availHeight > 0 ? fitRowHeight(availHeight, tierHeight, 30, 6) : { rowHeight: tierHeight, capacity: 30 };
}

test('줄 높이·줄 수 계산은 배포 전과 같다: 30px 이상으로 다 들어가는 모든 주문 수·높이(배포 순간 칠판이 바뀌지 않는다)', () => {
  for (let avail = 0; avail <= 900; avail += 1) {
    for (let n = 0; n <= 80; n++) {
      if (avail > 0 && 2 * Math.floor(avail / 30) < n) continue; // 30px로도 못 담는 주문 수는 아래 테스트(더 작은 단계)
      assert.deepEqual(rowLayout(n, avail, 30, 6), legacyLayout(n, avail), `avail ${avail}, rows ${n}`);
    }
  }
});

test('2026-11-17: 칠판(본문 606px)에서 주문 41~80건도 두 모니터에 다 들어간다(예전엔 40건 초과가 안 보임)', () => {
  for (let n = 41; n <= 80; n++) {
    const l = rowLayout(n, 606, 30, 6);
    assert.ok(2 * l.capacity >= n, `rows ${n}: capacity ${l.capacity}`);
    assert.ok(l.rowHeight >= 15 && l.rowHeight < 30, `rows ${n}: height ${l.rowHeight}`);
    assert.ok(l.capacity * l.rowHeight <= 606, `rows ${n}: 줄이 본문을 넘는다`);
    assert.equal(hiddenRowCount('2', n, l.capacity), 0);
  }
  assert.equal(hiddenRowCount('2', 81, rowLayout(81, 606, 30, 6).capacity), 1);
  assert.equal(rowLayout(80, 606, 30, 6).rowHeight, 15);
});

test('칠판(본문 606px)의 모니터 1 줄 수: 11/16 사진(주문 32건 → 17줄·35px)과 같다', () => {
  const at = (n: number) => rowLayout(n, 606, 30, 6);
  assert.deepEqual(at(32), { rowHeight: 35, capacity: 17 });
  assert.deepEqual(at(30), { rowHeight: 37, capacity: 16 });
  assert.equal(at(33).capacity, 19);
  assert.equal(at(36).capacity, 19);
  assert.equal(at(37).capacity, 20);
  assert.equal(at(40).capacity, 20);
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
