import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanShareText } from './share-text.ts';

test('글 끝의 줄바꿈과 공백을 없앤다', () => {
  assert.equal(cleanShareText('11/7일 영수증입니다.\n'), '11/7일 영수증입니다.');
  assert.equal(cleanShareText('11/7일 영수증입니다.\n\n  \n'), '11/7일 영수증입니다.');
  assert.equal(cleanShareText('  첫 줄\n'), '첫 줄');
});

test('여러 줄 글의 가운데 줄과 줄바꿈은 그대로 둔다', () => {
  assert.equal(cleanShareText('a\n\nb\n'), 'a\n\nb');
  assert.equal(cleanShareText('a  \r\nb\r\n'), 'a\nb');
});

test('빈 글은 빈 글이다', () => {
  assert.equal(cleanShareText(' \n '), '');
});
