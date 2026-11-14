// 인증 확인이 "로그인 안 됨"이 아니라 일시적으로 실패한 것인지 구분한다(순수 함수).
// Supabase Auth 서버가 잠깐 늦거나 네트워크가 끊겨 토큰 갱신·검증이 실패하면 auth-js는 AuthRetryableFetchError(또는 5xx·429 상태)를 돌려준다.
// 이때 세션 쿠키는 그대로 살아 있으므로 로그인 화면으로 보내면 안 된다: 사용자는 "아무것도 안 했는데 튕겼다"고 느낀다(2026-11-14 현장).
// 세션이 없거나(오류 없이 빈 결과) 리프레시 토큰이 폐기된 경우(4xx)는 일시적 오류가 아니다 → 로그인 화면으로 보낸다.
export function isTransientAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === 'AuthRetryableFetchError') return true;
  return typeof e.status === 'number' && (e.status >= 500 || e.status === 429);
}
