// 주문 목록 모니터 1·2는 모든 기기가 같은 크기의 "기준 화면"을 그리고, 창이 다르면 그 화면 전체를 확대·축소해서 보여 준다(순수 함수).
// 줄 수·열 폭·글자 크기·필기 위치가 기기마다 다르면 칠판에서 쓴 필기를 PC에서 같은 모양으로 볼 수 없어서다(2026-11-16 현장: 칠판 17줄, 사용자 PC 25줄, 형 PC 29줄).
//
// 기준 크기는 스마트 칠판(CSS 1280×720, 사이드바 접음)에서 주문 목록 본문 영역의 실제 크기다: 폭 1280 − 좌우 여백 32, 높이 720 − 위아래 여백 24.
// 칠판은 이 크기와 같아서 배율 1(변환 없음)로 지금과 똑같이 그려진다.
export const STAGE_W = 1248;
export const STAGE_H = 696;

// 이 범위 안이면 기준 크기와 같은 기기로 본다(칠판의 브라우저 주소창·스크롤바 때문에 어긋나도 배율을 걸지 않는다). 칠판 사진(주문 32건에 17줄)에서
// 추정한 칠판 본문 높이가 667~701px(기준 696)이라 ±6%로 잡았다. 같은 기기로 보면 변환 없이 창을 꽉 채워 그리고 펜으로 쓸 수 있다 — 칠판이 배율로 잘못 판정돼
// 펜이 막히는 일이 없도록 넉넉하게 둔다.
const NATIVE_TOLERANCE = 0.06;
const NATIVE_MIN_WIDTH_RATIO = 0.75; // 칠판에서 사이드바를 펼치면 본문 폭이 기준의 약 84%가 된다(그래도 펜은 써야 한다)

export interface StageLayout {
  native: boolean; // true면 배율 없이 바깥 영역을 그대로 채운다
  scale: number;
  width: number; // 안쪽 화면의 레이아웃 크기(배율을 걸기 전)
  height: number;
  left: number; // 바깥 영역 안에서 배율을 건 화면의 위치
  top: number;
}

// outerW·outerH: 화면을 놓을 수 있는 영역(주문 목록 본문 영역)의 크기.
export function stageLayout(outerW: number, outerH: number): StageLayout {
  if (!(outerW > 0) || !(outerH > 0)) return { native: true, scale: 1, width: Math.max(0, outerW || 0), height: Math.max(0, outerH || 0), left: 0, top: 0 };
  const rw = outerW / STAGE_W;
  const rh = outerH / STAGE_H;
  // 한 모니터에 들어가는 줄 수는 높이로만 정해지므로 높이가 기준과 같으면 줄 나눔이 칠판과 같다. 폭은 기준보다 좁아도(사이드바를 펼친 칠판 등) 같은 기기로 본다.
  if (Math.abs(rh - 1) <= NATIVE_TOLERANCE && rw >= NATIVE_MIN_WIDTH_RATIO && rw <= 1 + NATIVE_TOLERANCE) return { native: true, scale: 1, width: outerW, height: outerH, left: 0, top: 0 };
  const scale = Math.min(rw, rh);
  // 가로로만 가운데에 두고 세로는 위에 붙인다(도구줄이 칠판처럼 위에 있다).
  return { native: false, scale, width: STAGE_W, height: STAGE_H, left: (outerW - STAGE_W * scale) / 2, top: 0 };
}
