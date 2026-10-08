import Anthropic from '@anthropic-ai/sdk';

// 로컬 개발 환경에 키가 없어도 앱이 죽지 않고 AI fallback만 조용히 꺼지게 한다 —
// 카카오 파싱은 원래 정규식만으로도 동작하는 기능이라 AI는 보조 수단일 뿐이다.
let client: Anthropic | null | undefined;

export function getAnthropicClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  client = apiKey ? new Anthropic({ apiKey }) : null;
  return client;
}
