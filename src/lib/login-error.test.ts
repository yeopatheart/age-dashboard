import test from 'node:test';
import assert from 'node:assert/strict';
import { loginErrorMessage } from './login-error.ts';

test('a network failure is not reported as a wrong password', () => {
  assert.match(loginErrorMessage({ name: 'AuthRetryableFetchError', status: 0 }), /인터넷 연결/);
  assert.match(loginErrorMessage({ name: 'AuthUnknownError' }), /인터넷 연결/); // status 없음
});

test('rate limit and server errors get their own messages', () => {
  assert.match(loginErrorMessage({ status: 429 }), /너무 많습니다/);
  assert.match(loginErrorMessage({ status: 503 }), /서버가 응답하지 않습니다/);
});

test('invalid credentials keep the original message', () => {
  assert.equal(loginErrorMessage({ name: 'AuthApiError', status: 400, code: 'invalid_credentials' }), '이메일 또는 비밀번호가 올바르지 않습니다.');
});

test('unconfirmed accounts are told to contact the admin', () => {
  assert.match(loginErrorMessage({ status: 400, code: 'email_not_confirmed' }), /관리자/);
});
