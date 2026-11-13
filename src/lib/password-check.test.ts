import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordConfirmError } from './password-check.ts';

test('matching passwords pass', () => {
  assert.equal(passwordConfirmError('abcd1234', 'abcd1234'), null);
});

test('both empty passes (editing a user without changing the password)', () => {
  assert.equal(passwordConfirmError('', ''), null);
});

test('a typo in either field is caught', () => {
  assert.equal(passwordConfirmError('abcd1234', 'abcd1235'), '비밀번호가 서로 다릅니다.');
  assert.equal(passwordConfirmError('abcd1234', ''), '비밀번호가 서로 다릅니다.');
});

test('a confirm without a password is caught', () => {
  assert.equal(passwordConfirmError('', 'abcd1234'), '새 비밀번호를 먼저 입력하세요.');
});

test('spaces and case are part of the password', () => {
  assert.equal(passwordConfirmError('abcd1234', 'abcd1234 '), '비밀번호가 서로 다릅니다.');
  assert.equal(passwordConfirmError('Abcd1234', 'abcd1234'), '비밀번호가 서로 다릅니다.');
});
