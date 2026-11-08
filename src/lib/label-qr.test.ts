import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import { makeBoxBarcode } from './labels/barcode.ts';
import { DOT_MM, makeQrMatrix, qrModuleDots, qrModuleMm } from './labels/qr.ts';

// 칸 배열을 흰 여백(quiet zone 4칸)을 두른 그림으로 만들어 ZXing으로 읽는다(프린터·카메라 없이 하는 왕복 검사).
function decode(text: string, pxPerModule: number, quiet = 4): string {
  const m = makeQrMatrix(text);
  const side = (m.size + quiet * 2) * pxPerModule;
  const gray = new Uint8ClampedArray(side * side).fill(255);
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.dark[r * m.size + c]) continue;
      for (let y = 0; y < pxPerModule; y++) {
        for (let x = 0; x < pxPerModule; x++) gray[((r + quiet) * pxPerModule + y) * side + (c + quiet) * pxPerModule + x] = 0;
      }
    }
  }
  // RGBLuminanceSource는 ARGB 정수 배열을 받는다
  const argb = new Int32Array(side * side);
  gray.forEach((v, i) => (argb[i] = (255 << 24) | (v << 16) | (v << 8) | v));
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(argb, side, side)));
  return new QRCodeReader().decode(bitmap).getText();
}

test('12자리 번호는 버전 1(21칸)이다', () => {
  assert.equal(makeQrMatrix('261028012035').size, 21);
});

test('QR을 ZXing이 같은 번호로 읽는다', () => {
  const code = makeBoxBarcode('2026-10-28', 12, 3);
  assert.equal(decode(code, 8), code);
});

test('칸이 3도트 수준으로 작아도 읽힌다(칸당 픽셀 3)', () => {
  const code = makeBoxBarcode('2026-11-08', 999, 99);
  assert.equal(decode(code, 3), code);
});

test('칸 크기는 도트 정수배다', () => {
  for (const box of [13.1, 21, 23.6, 30]) {
    const dots = qrModuleDots(qrModuleMm(box, 21));
    assert.ok(Math.abs(dots - Math.round(dots)) < 1e-9, `${box}mm → ${dots}도트`);
    assert.ok(qrModuleMm(box, 21) * 21 <= box + 0.15, `${box}mm 상자를 0.15mm 넘게 벗어남`);
  }
  // 21mm 상자: 칸 1mm ≈ 7.99도트 → 8도트(상자보다 0.02mm 큰 정도는 허용). 5도트 칸(13.1mm)도 같은 방식이다.
  assert.equal(Math.round(qrModuleDots(qrModuleMm(21, 21))), 8);
  assert.equal(Math.round(qrModuleDots(qrModuleMm(13.1, 21))), 5);
  assert.ok(DOT_MM > 0.12 && DOT_MM < 0.126);
});
