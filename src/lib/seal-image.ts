// 사업자 직인(도장) 이미지 검증·크기 계산(순수 함수). 직인은 작게 줄인 PNG를 data URL 글자로 seller_businesses.seal_image에 저장한다(0047).
// 서버(저장 전 검증)와 화면(줄이기)이 같은 기준을 쓴다.

// DB 제약(0047)과 같은 상한. 글자 수 기준이다.
export const MAX_SEAL_CHARS = 300_000;
// 화면에서 줄일 때 긴 변의 크기(px) 후보. 앞에서부터 시도하고 상한을 넘으면 더 작게 줄인다.
export const SEAL_SIDE_STEPS = [256, 192, 128];
// 원본 파일 크기 상한. 너무 큰 파일은 브라우저에서 읽기 전에 거절한다.
export const MAX_SEAL_SOURCE_BYTES = 10 * 1024 * 1024;

const PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE_BASE64 = 'iVBORw0KGgo'; // PNG 파일 앞 8바이트(89 50 4E 47 0D 0A 1A 0A)를 base64로 쓴 것

// PNG data URL인지 확인한다: 접두사, 글자 수 상한, base64 글자만, PNG 시그니처. <img src>에 그대로 써도 안전한 값만 통과한다.
export function isValidSealDataUrl(value: string): boolean {
  if (!value.startsWith(PREFIX) || value.length > MAX_SEAL_CHARS) return false;
  const body = value.slice(PREFIX.length);
  return body.startsWith(PNG_SIGNATURE_BASE64) && /^[A-Za-z0-9+/]+={0,2}$/.test(body);
}

// 가로세로 비율을 지키며 긴 변이 maxSide를 넘지 않게 줄인다(작은 이미지는 키우지 않는다).
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
