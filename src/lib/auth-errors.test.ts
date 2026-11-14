import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientAuthError } from './supabase/auth-errors.ts';

test('일시적 인증 오류: 네트워크·서버 오류와 요청 한도만 해당한다', () => {
  assert.equal(isTransientAuthError({ name: 'AuthRetryableFetchError', status: 0 }), true);
  assert.equal(isTransientAuthError({ name: 'AuthApiError', status: 503 }), true);
  assert.equal(isTransientAuthError({ name: 'AuthApiError', status: 429 }), true);
});

test('세션 없음·폐기된 토큰·잘못된 JWT는 일시적 오류가 아니다(로그인 화면으로 보낸다)', () => {
  assert.equal(isTransientAuthError(null), false);
  assert.equal(isTransientAuthError(undefined), false);
  assert.equal(isTransientAuthError({ name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' }), false);
  assert.equal(isTransientAuthError({ name: 'AuthSessionMissingError', status: 400 }), false);
  assert.equal(isTransientAuthError({ name: 'AuthInvalidJwtError', status: 400 }), false);
});
