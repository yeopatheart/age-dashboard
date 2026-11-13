// 비밀번호 확인 칸 검증. 공백도 비밀번호의 일부라 다듬지 않고 그대로 비교한다.
// 둘 다 비어 있으면 통과: 사용자 수정에서 비밀번호를 바꾸지 않는 경우다(등록의 필수 여부는 호출하는 쪽이 따로 본다).
export function passwordConfirmError(password: string, confirm: string): string | null {
  if (password === confirm) return null;
  if (!password) return '새 비밀번호를 먼저 입력하세요.';
  return '비밀번호가 서로 다릅니다.';
}
