// 펜 획이 "동그라미" 또는 "직선"인지, 어느 상품 칸에 한 것인지 판정한다(순수 함수). 확정 설계는 docs/decisions/2026-11-14-board-pen-feature.md.
// 좌표는 모두 같은 화면 좌표(CSS px)다. 기준값은 칠판에서 시험하며 맞추도록 한곳(GESTURE)에 모아 두었다.
import type { Pt } from './canvas.ts';

export interface Target {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export const GESTURE = {
  minPoints: 3,
  minPathPx: 24, // 이보다 짧은 획은 점이나 낙서로 본다
  // 동그라미
  circleMinCoverage: 0.4, // 상품 칸 면적의 이 비율 이상을 감싸면 후보가 된다(사용자 결정: 85% → 40%)
  // 후보가 여럿이면 원의 중심에 가장 가까운 칸을 고른다(칸이 위아래로 촘촘해서 큰 원은 옆줄 칸도 40% 넘게 감싼다 — 2026-11-14 현장).
  // 거리는 칸 크기(반폭·반높이)로 나눈 값이고, 1등과 2등의 거리 차가 이보다 작으면(원의 중심이 두 칸의 한가운데) 애매해서 무시한다.
  circleCenterGap: 0.3,
  circleMaxClosure: 0.35, // 시작점과 끝점 사이 거리 ≤ 획 바깥 상자 대각선의 이 비율
  circleMinTurnRad: Math.PI * 1.6, // 한 방향으로 도는 각도(약 290°) 이상
  circleMaxWidthRatio: 3.2, // 원의 바깥 상자가 칸보다 이 배수보다 크면 너무 큰 원
  circleMaxHeightRatio: 4,
  // 직선(방향 무관: 대각선·가로선·세로선, 사용자 결정 2026-11-14)
  lineMinStraight: 0.85, // 시작-끝 거리 / 획 길이
  lineMinCover: 0.25, // 칸을 선 방향으로 가로지른 길이 / 그 방향으로 잰 칸의 길이 ≥ 이 비율이면 후보(사용자 결정 2026-11-14: 50% → 25%). 획이 minPathPx(24px)보다 짧으면 비율과 상관없이 점·낙서로 본다
  lineMinInside: 0.5, // 획 길이 중 칸 안에 있는 비율(칸 밖으로 많이 벗어난 긴 선은 제외)
  lineDominanceGap: 0.2, // 두 칸이 비슷하게 걸치면(두 번째 칸이 이만큼 못 미치지 않으면) 애매해서 무시
} as const;

export type GestureReason = 'too-short' | 'not-closed' | 'not-enough-turn' | 'no-target' | 'ambiguous' | 'too-big';
export type GestureResult = { kind: 'circle' | 'line'; itemId: string; coverage: number } | { kind: 'none'; reason: GestureReason };

export const REASON_LABEL: Record<GestureReason, string> = {
  'too-short': '획이 너무 짧음',
  'not-closed': '원이 닫히지 않음',
  'not-enough-turn': '한 바퀴를 덜 돌림',
  'no-target': '기준에 맞는 상품 칸이 없음',
  ambiguous: '두 칸 사이라 애매함',
  'too-big': '원이 너무 큼',
};

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

export function bounds(points: Pt[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { left, top, right, bottom };
}

// 점이 너무 촘촘하면 각도 계산이 떨림에 흔들려서, 일정 거리 이상 떨어진 점만 남긴다(마지막 점은 항상 남긴다).
export function thin(points: Pt[], minStep: number): Pt[] {
  if (points.length === 0) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (dist(out[out.length - 1], points[i]) >= minStep) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

// 한 방향으로 돈 각도의 합(부호 있음). 지그재그는 서로 상쇄되어 작아진다.
export function signedTurning(points: Pt[]): number {
  let total = 0;
  for (let i = 2; i < points.length; i++) {
    const a1 = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
    const a2 = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return total;
}

// 짝수-홀수 규칙으로 점이 다각형(획을 닫은 모양) 안에 있는지 본다.
export function insidePolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 칸을 격자로 나눠 그 중심이 다각형 안에 있는 비율(칸 면적 중 감싼 비율).
export function coverage(rect: Target, polygon: Pt[], cols = 9, rows = 4): number {
  let inside = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: rect.left + ((c + 0.5) / cols) * rect.width, y: rect.top + ((r + 0.5) / rows) * rect.height };
      if (insidePolygon(p, polygon)) inside++;
    }
  }
  return inside / (cols * rows);
}

// 획을 일정 간격으로 다시 찍은 점들(칸 안에 있는 길이를 재는 데 쓴다).
function sample(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  out.push(points[points.length - 1]);
  return out;
}

function classifyCircle(points: Pt[], targets: Target[]): GestureResult {
  const b = bounds(points);
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const diag = Math.hypot(w, h);
  if (dist(points[0], points[points.length - 1]) > GESTURE.circleMaxClosure * diag) return { kind: 'none', reason: 'not-closed' };
  if (Math.abs(signedTurning(thin(points, 3))) < GESTURE.circleMinTurnRad) return { kind: 'none', reason: 'not-enough-turn' };

  // 40% 이상 감싼 칸이 후보. 그중 원의 중심(바깥 상자의 중심)에 가장 가까운 칸을 고른다.
  const gx = (b.left + b.right) / 2;
  const gy = (b.top + b.bottom) / 2;
  const candidates = targets
    .map((t) => ({ t, c: coverage(t, points), d: Math.hypot((t.left + t.width / 2 - gx) / (t.width / 2), (t.top + t.height / 2 - gy) / (t.height / 2)) }))
    .filter((s) => s.c >= GESTURE.circleMinCoverage)
    .sort((x, y) => x.d - y.d);
  const best = candidates[0];
  if (!best) return { kind: 'none', reason: 'no-target' };
  const second = candidates[1];
  if (second && second.d - best.d < GESTURE.circleCenterGap) return { kind: 'none', reason: 'ambiguous' };
  if (w > GESTURE.circleMaxWidthRatio * best.t.width || h > GESTURE.circleMaxHeightRatio * best.t.height) return { kind: 'none', reason: 'too-big' };
  return { kind: 'circle', itemId: best.t.id, coverage: best.c };
}

// 거의 곧은 획이 칸의 25% 이상을 지나면(방향과 상관없이) 그 칸이다.
function classifyLine(points: Pt[], targets: Target[], length: number): GestureResult {
  const first = points[0];
  const last = points[points.length - 1];
  const chord = dist(first, last);
  const ux = Math.abs(last.x - first.x) / chord;
  const uy = Math.abs(last.y - first.y) / chord;
  const dots = sample(points, 2);
  const candidates: { t: Target; cover: number }[] = [];
  for (const t of targets) {
    const insideRatio = dots.filter((p) => p.x >= t.left && p.x <= t.left + t.width && p.y >= t.top && p.y <= t.top + t.height).length / dots.length;
    // 선 방향으로 칸을 가로지르는 길이(중심을 지나는 현): 가로선이면 칸의 폭, 세로선이면 높이, 대각선이면 그 사이.
    const crossing = Math.min(ux > 1e-6 ? t.width / ux : Infinity, uy > 1e-6 ? t.height / uy : Infinity);
    const cover = (insideRatio * length) / crossing;
    if (insideRatio >= GESTURE.lineMinInside && cover >= GESTURE.lineMinCover) candidates.push({ t, cover: Math.min(cover, 1) });
  }
  candidates.sort((x, y) => y.cover - x.cover);
  const best = candidates[0];
  if (!best) return { kind: 'none', reason: 'no-target' };
  const second = candidates[1];
  if (second && best.cover - second.cover < GESTURE.lineDominanceGap) return { kind: 'none', reason: 'ambiguous' };
  return { kind: 'line', itemId: best.t.id, coverage: best.cover };
}

// 획 하나를 판정한다. targets는 화면에 보이는 상품 칸 전부(이미 포장된 칸·취소된 칸 포함 — 애매함을 정확히 가리려면 모두 필요하다).
// 이미 포장 완료인 칸, 취소된 칸을 무시하는 것은 호출하는 쪽의 몫이다.
export function classifyStroke(points: Pt[], targets: Target[]): GestureResult {
  const length = pathLength(points);
  if (points.length < GESTURE.minPoints || length < GESTURE.minPathPx) return { kind: 'none', reason: 'too-short' };
  const chord = dist(points[0], points[points.length - 1]);
  if (chord / length >= GESTURE.lineMinStraight) return classifyLine(points, targets, length);
  return classifyCircle(points, targets);
}
