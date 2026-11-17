import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backingSize, needsFit } from './ink/canvas.ts';

// 버퍼를 rect에 맞게 잡은 상태(fitCanvas 직후)에서 needsFit이 판단하는 값
const fitted = (w: number, h: number, dpr: number) => backingSize(w, h, dpr);

test('맞게 잡힌 캔버스는 다시 잡지 않는다 (dpr 1·2·3, 소수 배율)', () => {
  for (const dpr of [1, 2, 3, 1.25, 1.5]) {
    for (const [w, h] of [[1248, 696], [1280, 720], [1043.37, 581.62]]) {
      const b = fitted(w, h, dpr);
      assert.equal(needsFit(b.width, b.height, w, h, dpr), false, `dpr ${dpr} ${w}x${h}`);
    }
  }
});

test('배율이 바뀌어 rect가 k배가 되면 다시 잡아야 한다', () => {
  for (const dpr of [1, 2, 3]) {
    const b = fitted(1248, 696, dpr); // 배율 1 때 잡은 버퍼
    for (const k of [0.6, 0.85, 1.2, 1.5]) {
      assert.equal(needsFit(b.width, b.height, 1248 * k, 696 * k, dpr), true, `dpr ${dpr} k ${k}`);
    }
  }
});

test('가로만 또는 세로만 달라져도 다시 잡는다', () => {
  const b = fitted(1000, 600, 2);
  assert.equal(needsFit(b.width, b.height, 1100, 600, 2), true);
  assert.equal(needsFit(b.width, b.height, 1000, 700, 2), true);
});

test('±1px 허용오차 경계: 1px 차이는 같고 2px 차이는 다르다', () => {
  // dpr 1, rect 1000x600 -> 버퍼 1000x600
  assert.equal(needsFit(1001, 600, 1000, 600, 1), false);
  assert.equal(needsFit(999, 600, 1000, 600, 1), false);
  assert.equal(needsFit(1000, 601, 1000, 600, 1), false);
  assert.equal(needsFit(1000, 599, 1000, 600, 1), false);
  assert.equal(needsFit(1002, 600, 1000, 600, 1), true);
  assert.equal(needsFit(998, 600, 1000, 600, 1), true);
  assert.equal(needsFit(1000, 602, 1000, 600, 1), true);
  assert.equal(needsFit(1000, 598, 1000, 600, 1), true);
});

test('반올림 경계의 작은 rect 변화(0.4px)로는 다시 잡지 않는다', () => {
  const b = fitted(1248, 696, 3);
  assert.equal(needsFit(b.width, b.height, 1248.4, 696.4, 3), false); // 버퍼 차이 1px 이내
});

test('0·음수·NaN 크기는 판단하지 않는다 (false, 예외 없음)', () => {
  assert.equal(needsFit(1, 1, 0, 0, 1), false);
  assert.equal(needsFit(300, 150, 0, 600, 2), false);
  assert.equal(needsFit(300, 150, 600, 0, 2), false);
  assert.equal(needsFit(300, 150, -5, 600, 2), false);
  assert.equal(needsFit(300, 150, Number.NaN, 600, 2), false);
  assert.equal(needsFit(0, 0, 100, 100, 1), true); // 버퍼가 0이면(아직 안 잡힘) 맞춘다
});

test('dpr이 0·음수·NaN이면 1로 본다', () => {
  assert.equal(needsFit(1000, 600, 1000, 600, 0), false);
  assert.equal(needsFit(1000, 600, 1000, 600, -2), false);
  assert.equal(needsFit(1000, 600, 1000, 600, Number.NaN), false);
});

test('fit 뒤에는 같은 입력에서 다시 잡을 필요가 없다 (재호출 루프 없음)', () => {
  const rect = { w: 1248 * 0.73, h: 696 * 0.73 };
  const dpr = 2;
  let buf = fitted(1248, 696, dpr);
  assert.equal(needsFit(buf.width, buf.height, rect.w, rect.h, dpr), true);
  buf = fitted(rect.w, rect.h, dpr); // fitCanvas
  assert.equal(needsFit(buf.width, buf.height, rect.w, rect.h, dpr), false);
});
