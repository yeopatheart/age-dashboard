// 펜 그림(잉크) 캔버스 공용 도구. 진단 페이지(/dashboard/pen-test)와 앞으로 만들 펜 기능이 같이 쓴다.
//
// 선명도: 스마트 칠판 브라우저는 CSS 화면이 1280×720이고 devicePixelRatio가 3(물리 4K)이다(2026-11-14 진단 결과).
// 캔버스의 그림 해상도를 CSS 크기 그대로 두면 브라우저가 3배로 늘려 보여서 선이 깨져 보인다 → 그림 해상도를 CSS 크기 × devicePixelRatio로 잡고,
// 그리기 좌표는 CSS 픽셀 그대로 쓰도록 변환(scale)을 걸어 둔다.

export interface Pt {
  x: number;
  y: number;
}

// 캔버스 그림 해상도(px). 소수 배율(1.25 등)에서도 가장자리가 잘리지 않게 반올림한다.
export function backingSize(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number } {
  const scale = dpr > 0 ? dpr : 1;
  return { width: Math.max(1, Math.round(cssWidth * scale)), height: Math.max(1, Math.round(cssHeight * scale)) };
}

// 캔버스를 화면에 보이는 크기에 맞춰 다시 잡는다. 크기를 바꾸면 그림이 지워지므로 호출한 쪽이 저장해 둔 획을 다시 그려야 한다.
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; cssWidth: number; cssHeight: number } | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = backingSize(rect.width, rect.height, dpr);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(width / rect.width, 0, 0, height / rect.height, 0, 0); // 반올림 오차까지 반영해 CSS 좌표와 정확히 맞춘다
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { ctx, cssWidth: rect.width, cssHeight: rect.height };
}

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// 선 보정: 적외선 터치 프레임은 좌표를 듬성듬성 보고해서 점을 직선으로 이으면 각져 보인다.
// 이전 두 점의 중간점들을 이어 가며 이전 점을 조절점으로 쓰는 2차 곡선으로 그리면 부드럽게 이어진다.
export interface InkCursor {
  last: Pt; // 마지막으로 받은 점
  mid: Pt; // 마지막으로 그린 곡선의 끝(중간점)
}

export const startInk = (p: Pt): InkCursor => ({ last: p, mid: p });

export function extendInk(ctx: CanvasRenderingContext2D, cursor: InkCursor, p: Pt): InkCursor {
  const mid = { x: (cursor.last.x + p.x) / 2, y: (cursor.last.y + p.y) / 2 };
  ctx.beginPath();
  ctx.moveTo(cursor.mid.x, cursor.mid.y);
  ctx.quadraticCurveTo(cursor.last.x, cursor.last.y, mid.x, mid.y);
  ctx.stroke();
  return { last: p, mid };
}

// 획이 끝나면 마지막 중간점에서 마지막 점까지 이어 끝이 짧아 보이지 않게 한다. 점 하나만 찍은 획(탭)은 점으로 그린다.
export function endInk(ctx: CanvasRenderingContext2D, cursor: InkCursor): void {
  ctx.beginPath();
  if (cursor.mid.x === cursor.last.x && cursor.mid.y === cursor.last.y) {
    ctx.arc(cursor.last.x, cursor.last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }
  ctx.moveTo(cursor.mid.x, cursor.mid.y);
  ctx.lineTo(cursor.last.x, cursor.last.y);
  ctx.stroke();
}
