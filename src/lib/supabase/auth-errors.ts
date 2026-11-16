// 인증 확인이 "로그인 안 됨"이 아니라 일시적으로 실패한 것인지 구분한다(순수 함수).
// Supabase Auth 서버가 잠깐 늦거나 네트워크가 끊겨 토큰 갱신·검증이 실패하면 auth-js는 AuthRetryableFetchError(또는 5xx·429 상태)를 돌려준다.
// 이때 세션 쿠키는 그대로 살아 있으므로 로그인 화면으로 보내면 안 된다: 사용자는 "아무것도 안 했는데 튕겼다"고 느낀다(2026-11-14 현장).
// 같은 세션의 토큰을 여러 요청이 동시에 갱신하려 하면 Auth 서버가 늦은 쪽에 409(code 'conflict', "Too many concurrent token refresh requests")를 돌려준다.
// 탭·메뉴 미리불러오기·칠판이 한꺼번에 열리는 배포 직후에 생기고(2026-11-16 09:51 운영 로그), 세션은 멀쩡하며 잠시 뒤 다시 시도하면 된다.
// 이것을 "권한 없음"이나 "로그인 안 됨"으로 처리하면 칠판의 펜이 막히거나 로그인 화면으로 튕긴다.
// 세션이 없거나(오류 없이 빈 결과) 리프레시 토큰이 폐기된 경우(4xx)는 일시적 오류가 아니다 → 로그인 화면으로 보낸다.
export function isTransientAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; status?: unknown; code?: unknown };
  if (e.name === 'AuthRetryableFetchError') return true;
  if (e.status === 409 || e.code === 'conflict') return true;
  return typeof e.status === 'number' && (e.status >= 500 || e.status === 429);
}
