import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripGluedOrderNumber } from './glued-order-number.ts';

const known = new Set(['남부', '대구', '해운대', '5도장']);
const line = (terminalName: string, orderNumberRaw: string | null = null) => ({ orderNumberRaw, terminalName, businessName: '알라프리마' });

test('번호가 붙은 터미널("20남부")은 번호와 등록된 터미널로 나눈다', () => {
  assert.deepEqual(stripGluedOrderNumber(line('20남부'), known), line('남부', '20'));
  assert.deepEqual(stripGluedOrderNumber(line('3 해운대'.replace(' ', '')), known), line('해운대', '3'));
});

test('이미 번호가 있거나 등록된 이름 그대로면 건드리지 않는다', () => {
  assert.deepEqual(stripGluedOrderNumber(line('남부', '20'), known), line('남부', '20'));
  assert.deepEqual(stripGluedOrderNumber(line('5도장'), known), line('5도장')); // 실제 터미널 이름
  assert.deepEqual(stripGluedOrderNumber(line('남부'), known), line('남부'));
});

test('떼어 낸 나머지가 등록된 터미널이 아니면 새 터미널로 그대로 둔다', () => {
  assert.deepEqual(stripGluedOrderNumber(line('20새터미널'), known), line('20새터미널'));
  assert.deepEqual(stripGluedOrderNumber(line('123'), known), line('123'));
  assert.deepEqual(stripGluedOrderNumber(line(''), known), line(''));
});
