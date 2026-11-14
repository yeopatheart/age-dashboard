// 스마트 칠판처럼 "터치 입력이 있는 데스크톱 화면"인지 판별한다(휴대폰·태블릿 제외).
// 칠판 기기에서만 펜 플로팅 버튼을 보이기 위한 것이다. 진단 결과 칠판은 Linux Chrome, maxTouchPoints 2, 화면 1280×720이다(2026-11-13).
// 칠판만 콕 집어 식별할 방법이 없어서 "터치 입력 있음 + 휴대폰·태블릿 아님 + 폭 768px 초과"로 가린다(터치 노트북도 포함될 수 있다).
export interface DeviceInfo {
  maxTouchPoints: number;
  userAgent: string;
  width: number;
  platform?: string;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Tablet/i;

export function isTouchDesktop({ maxTouchPoints, userAgent, width, platform = '' }: DeviceInfo): boolean {
  if (maxTouchPoints < 1) return false;
  if (width <= 768) return false;
  if (MOBILE_UA.test(userAgent)) return false;
  // iPadOS는 데스크톱 Safari로 위장해 UA에 Macintosh로 나온다. 맥은 터치 점이 없으므로 터치가 있으면 아이패드다.
  if (/Mac/i.test(platform || userAgent)) return false;
  return true;
}
