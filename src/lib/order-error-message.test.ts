import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransportError, previewErrorMessage, commitErrorMessage } from './order-error-message.ts';

test('브라우저의 연결 오류는 영어 원문이 아니라 한국어 안내가 된다', () => {
  assert.equal(isTransportError(new TypeError('Failed to fetch')), true);
  assert.equal(isTransportError(new TypeError('Load failed')), true);
  assert.equal(isTransportError(new Error('상품 저장 실패: x')), false);
  assert.match(previewErrorMessage(new TypeError('Failed to fetch')), /서버에 연결하지 못했습니다/);
});

test('서버가 보낸 한국어 오류는 그대로 보여 준다', () => {
  assert.equal(previewErrorMessage(new Error('내일까지만 미리 입력할 수 있습니다.')), '내일까지만 미리 입력할 수 있습니다.');
  assert.equal(commitErrorMessage(new Error('상품 저장 실패: x')), '상품 저장 실패: x');
  assert.equal(commitErrorMessage('?'), '확정에 실패했습니다.');
});
