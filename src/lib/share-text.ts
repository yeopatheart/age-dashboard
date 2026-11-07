// 복사·공유(카카오톡 등)로 내보내는 글을 정리한다: 줄바꿈을 \n으로 통일하고, 줄 끝 공백과 글 앞뒤의 빈 줄·공백을 없앤다.
// 글 끝에 줄바꿈이 하나라도 남으면 받는 쪽 메시지 아래에 빈 줄이 생긴다.
export function cleanShareText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .trim();
}
