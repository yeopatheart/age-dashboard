// 서버 호출이 던진 오류를 화면에 보여 줄 한국어 문구로 바꾼다.
// 연결이 끊기면 브라우저가 영어 원문("Failed to fetch" 등)을 던진다. 그 경우 서버가 요청을 받아 저장했을 수도 있어서(응답만 유실) 저장 여부를 단정하지 않는다.
export function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|aborted|timeout/i.test(error.message);
}

export function previewErrorMessage(error: unknown): string {
  if (isTransportError(error)) return '서버에 연결하지 못했습니다. 연결을 확인하고 미리보기를 다시 눌러 주세요.';
  return error instanceof Error && error.message ? error.message : '미리보기에 실패했습니다.';
}

// 확정 호출이 연결 오류로 끝난 경우: 서버가 저장을 마쳤는지 알 수 없다. 같은 내용을 그대로 다시 확정하면 새 줄이 두 번 들어갈 수 있으므로
// 호출한 쪽은 미리보기를 비우고 다시 분석해서(이미 저장된 줄은 "변경 없음"으로 나온다) 남은 것만 확정하게 한다.
export const COMMIT_UNKNOWN_MESSAGE = '연결이 끊겨 저장됐는지 확인하지 못했습니다. 아래 미리보기를 새로 읽었습니다 — 이미 저장된 줄은 "변경 없음"으로 보입니다. 남은 것만 확정해 주세요.';

export function commitErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '확정에 실패했습니다.';
}
