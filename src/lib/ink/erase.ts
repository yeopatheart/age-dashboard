// 지우개: 획에서 지우개 원 안에 든 부분을 잘라 내고 남은 조각들을 돌려준다(순수 함수).
import type { Pt } from './canvas.ts';

// 칠판의 적외선 터치는 점이 듬성듬성 보고되어, 두 점 사이를 지우개가 지나가도 점이 하나도 원 안에 없을 수 있다.
// 그래서 지우기 전에 획을 maxStep 이하 간격으로 촘촘하게 다시 찍는다.
export function densify(points: Pt[], maxStep: number): Pt[] {
  if (points.length < 2 || maxStep <= 0) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxStep));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

// 지워지지 않은 연속 구간들. 점이 하나만 남은 조각은 선이 되지 못하므로 버린다.
export function splitByMask<T>(items: T[], erased: boolean[]): T[][] {
  const pieces: T[][] = [];
  let run: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (erased[i]) {
      if (run.length >= 2) pieces.push(run);
      run = [];
    } else {
      run.push(items[i]);
    }
  }
  if (run.length >= 2) pieces.push(run);
  return pieces;
}

// 획 하나를 지운 결과. changed가 false면 지워진 점이 없다(pieces는 원래 획 하나).
export function eraseStroke(points: Pt[], center: Pt, radius: number): { changed: boolean; pieces: Pt[][] } {
  const dense = densify(points, Math.max(2, radius / 2));
  const erased = dense.map((p) => Math.hypot(p.x - center.x, p.y - center.y) <= radius);
  if (!erased.some(Boolean)) return { changed: false, pieces: [points] };
  return { changed: true, pieces: splitByMask(dense, erased) };
}
