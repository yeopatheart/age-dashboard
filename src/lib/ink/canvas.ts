// 펜 그림(잉크) 캔버스 공용 도구. 진단 페이지(/dashboard/pen-test)와 칠판 펜 기능이 같이 쓴다.
//
// 선명도: 스마트 칠판 브라우저는 CSS 화면이 1280×720이고 devicePixelRatio가 3(물리 4K)이다(2026-11-14 진단 결과).
// 캔버스의 그림 해상도를 CSS 크기 그대로 두면 브라우저가 3배로 늘려 보여서 선이 깨져 보인다 → 그림 해상도를 CSS 크기 × devicePixelRatio로 잡고,
// 그리기 좌표는 CSS 픽셀 그대로 쓰도록 변환(scale)을 걸어 둔다.
//
// 충실도(2026-11-14 사용자 요청: "사람이 쓴 그대로, 보정 없이 명확하고 깔끔하게"): 점들을 곡선으로 이을 때 점을 깎거나 옮기지 않는다.
// 이전의 중간점 곡선은 실제로 지나간 점을 지나지 않고 모서리를 깎아 글씨 모양이 바뀌었다. 지금 곡선은 받은 점을 **모두 정확히 지나고**,
// 급하게 꺾이는 점(55° 초과)은 꺾임 그대로 두며, 그 사이만 부드럽게 잇는다. 쓰는 동안(점이 올 때마다)과 다시 그릴 때(drawPath)가
// 같은 곡선을 그려서, 획을 마쳤을 때 모양이 달라 보이지 않는다.

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

const CORNER_COS = Math.cos((55 * Math.PI) / 180); // 방향이 이보다 크게 꺾이는 점은 꺾임으로 둔다

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function unit(a: Pt, b: Pt): Pt | null {
  const d = dist(a, b);
  return d < 1e-6 ? null : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

// 점 cur에서의 접선 방향. 끝점이면 이웃 쪽 방향, 급하게 꺾이는 점이면 null(꺾임을 그대로 둔다).
function tangent(prev: Pt | null, cur: Pt, next: Pt | null): Pt | null {
  const a = prev ? unit(prev, cur) : null;
  const b = next ? unit(cur, next) : null;
  if (a && b) {
    if (a.x * b.x + a.y * b.y < CORNER_COS) return null;
    const sx = a.x + b.x;
    const sy = a.y + b.y;
    const n = Math.hypot(sx, sy);
    return n < 1e-6 ? null : { x: sx / n, y: sy / n };
  }
  return b ?? a;
}

// p1→p2 한 구간을 그린다. 곡선은 두 점을 정확히 지나고, 조절점은 이웃 구간 방향으로 구간 길이의 1/3만큼만 나간다(되튐 없음).
// p0·p3는 앞뒤 이웃 점이고 없으면(획의 처음·끝) null이다.
export function drawSegment(ctx: CanvasRenderingContext2D, p0: Pt | null, p1: Pt, p2: Pt, p3: Pt | null): void {
  const len = dist(p1, p2);
  if (len < 1e-6) return;
  const t1 = tangent(p0, p1, p2);
  const t2 = tangent(p1, p2, p3);
  const h = len / 3;
  const c1 = t1 ? { x: p1.x + t1.x * h, y: p1.y + t1.y * h } : p1;
  const c2 = t2 ? { x: p2.x - t2.x * h, y: p2.y - t2.y * h } : p2;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, p: Pt): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

// 연속으로 같은 자리의 점은 하나로 본다(쓰는 동안과 다시 그릴 때 같은 점 목록이 되도록).
function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (out.length === 0 || dist(out[out.length - 1], p) >= 1e-6) out.push(p);
  return out;
}

// 획 전체를 그린다(저장된 획을 다시 그릴 때). 점 하나뿐인 획(탭)은 점으로 그린다.
export function drawPath(ctx: CanvasRenderingContext2D, points: Pt[]): void {
  const pts = dedupe(points);
  if (pts.length === 0) return;
  if (pts.length === 1) {
    dot(ctx, pts[0]);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) drawSegment(ctx, pts[i - 1] ?? null, pts[i], pts[i + 1], pts[i + 2] ?? null);
}

// 쓰는 동안 점이 올 때마다 그린다. 한 구간의 곡선은 그 다음 점이 와야 정해지므로, 새 점이 오면 그 앞 구간까지 그리고
// 획이 끝나면(endInk) 남은 구간을 그린다. 그려진 결과는 drawPath로 한꺼번에 그린 것과 똑같다.
export interface LiveInk {
  pts: Pt[];
  drawn: number; // 이미 그린 구간 수
}

export const startInk = (p: Pt): LiveInk => ({ pts: [p], drawn: 0 });

export function extendInk(ctx: CanvasRenderingContext2D, live: LiveInk, p: Pt): LiveInk {
  if (dist(live.pts[live.pts.length - 1], p) < 1e-6) return live;
  live.pts.push(p);
  while (live.drawn <= live.pts.length - 3) {
    const k = live.drawn;
    drawSegment(ctx, live.pts[k - 1] ?? null, live.pts[k], live.pts[k + 1], live.pts[k + 2]);
    live.drawn++;
  }
  return live;
}

export function endInk(ctx: CanvasRenderingContext2D, live: LiveInk): void {
  if (live.pts.length === 1) {
    dot(ctx, live.pts[0]);
    return;
  }
  while (live.drawn <= live.pts.length - 2) {
    const k = live.drawn;
    drawSegment(ctx, live.pts[k - 1] ?? null, live.pts[k], live.pts[k + 1], live.pts[k + 2] ?? null);
    live.drawn++;
  }
}

// 쓰는 도중에 캔버스를 지우고 다시 그려야 할 때(데이터 갱신으로 전체를 다시 그릴 때) 진행 중인 획을 이미 그려 둔 구간까지 그대로 복원한다.
// extendInk가 그린 것과 같은 구간을 같은 이웃 점으로 그리므로 이어서 그려도 이음매가 생기지 않는다.
export function redrawLive(ctx: CanvasRenderingContext2D, live: LiveInk): void {
  for (let k = 0; k < live.drawn; k++) drawSegment(ctx, live.pts[k - 1] ?? null, live.pts[k], live.pts[k + 1], live.pts[k + 2]);
}
