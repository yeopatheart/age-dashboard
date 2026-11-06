import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, isValidSealDataUrl, MAX_SEAL_CHARS } from './seal-image.ts';

// 1x1 투명 PNG
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('a real PNG data URL is accepted', () => {
  assert.equal(isValidSealDataUrl(TINY_PNG), true);
});

test('other image types, scripts and malformed values are rejected', () => {
  assert.equal(isValidSealDataUrl(''), false);
  assert.equal(isValidSealDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), false);
  assert.equal(isValidSealDataUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4='), false);
  assert.equal(isValidSealDataUrl('https://example.com/seal.png'), false);
  assert.equal(isValidSealDataUrl('data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false); // PNG 시그니처 아님
  assert.equal(isValidSealDataUrl('data:image/png;base64,iVBORw0KGgo"onerror="alert(1)'), false); // base64 글자 아님
  assert.equal(isValidSealDataUrl('data:image/png;base64,'), false);
});

test('values over the size cap are rejected', () => {
  const big = `data:image/png;base64,iVBORw0KGgo${'A'.repeat(MAX_SEAL_CHARS)}`;
  assert.equal(isValidSealDataUrl(big), false);
});

test('fitWithin keeps the aspect ratio and never enlarges', () => {
  assert.deepEqual(fitWithin(1024, 576, 256), { width: 256, height: 144 });
  assert.deepEqual(fitWithin(576, 1024, 256), { width: 144, height: 256 });
  assert.deepEqual(fitWithin(100, 50, 256), { width: 100, height: 50 });
  assert.deepEqual(fitWithin(10000, 1, 256), { width: 256, height: 1 });
});
