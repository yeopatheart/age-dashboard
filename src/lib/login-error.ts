// 로그인 실패 원인을 사용자에게 알맞은 문구로 바꾼다(순수 함수). 네트워크가 끊긴 것을 "비밀번호가 틀렸다"고 알리면 현장에서 헷갈린다.
export interface LoginErrorLike {
  name?: string;
  status?: number;
  code?: string;
}

export function loginErrorMessage(error: LoginErrorLike): string {
  const status = error.status ?? 0;
  if (error.name === 'AuthRetryableFetchError' || status === 0) return '인터넷 연결을 확인해 주세요. 연결이 되면 다시 로그인해 주세요.';
  if (status === 429 || error.code === 'over_request_rate_limit') return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return '서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.';
  if (error.code === 'email_not_confirmed') return '아직 사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.';
  return '이메일 또는 비밀번호가 올바르지 않습니다.';
}
