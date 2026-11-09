import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barcodeOrderDate, isValidBoxBarcode, makeBoxBarcode } from './labels/barcode.ts';

test('라벨 번호 앞 6자리에서 주문일을 읽는다', () => {
  assert.equal(barcodeOrderDate('261109002016'), '2026-11-09');
  assert.equal(barcodeOrderDate(makeBoxBarcode('2027-01-05', 7, 3)), '2027-01-05');
});

test('만든 번호의 날짜가 만들 때 쓴 주문일과 왕복해서 같다', () => {
  for (const date of ['2026-11-09', '2026-12-31', '2027-02-28']) {
    const code = makeBoxBarcode(date, 12, 1);
    assert.equal(isValidBoxBarcode(code), true);
    assert.equal(barcodeOrderDate(code), date);
  }
});
