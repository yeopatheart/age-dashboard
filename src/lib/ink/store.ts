// 펜 그림의 저장 형식과 좌표 변환(순수 함수). 이 기기(localStorage)에 날짜·모니터별로 저장하고, 새로고침해도 남는다.
//
// 좌표 두 종류:
// - 낙서(anchor 없음): 그림 층 크기에 대한 비율(0~1). 화면 크기가 달라져도 위치가 맞는다.
// - 상품 칸에 붙은 획(anchor = 상품 id): 그 칸의 크기에 대한 비율. 칸이 움직이거나 열 폭이 바뀌어도 따라간다.
import type { Pt } from './canvas.ts';
import { thin } from './gesture.ts';

export interface InkStroke {
  id: string;
  color: string;
  width: number; // CSS px
  pts: number[]; // [x0, y0, x1, y1, ...]
  anchor?: string; // 붙은 상품 id
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MAX_STROKES = 300;
// 저장본으로 다시 그려도 쓰던 모양과 같게 하려고 점을 거의 줄이지 않는다(2026-11-14: 3px로 솎고 240점으로 자르던 것이 글씨 모양을 바꿨다).
// 쓰는 동안에도 같은 간격(STORE_MIN_STEP)으로만 점을 받으므로(ink-layer) 저장본과 쓰던 점 목록이 같다.
export const MAX_POINTS = 800; // 획 하나가 저장하는 점 상한(긴 글씨 한 획도 넉넉하다)
export const STORE_MIN_STEP = 1.5; // 이보다 가까운 점은 버린다(CSS px). 1.5px 미만은 같은 자리로 봐도 눈에 보이지 않는다
const COLOR = /^#[0-9a-f]{6}$/i;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// 저장할 점 줄이기: 가까운 점을 버리고, 그래도 상한을 넘으면 일정 간격으로 솎는다(처음과 끝은 남긴다).
export function thinForStorage(points: Pt[]): Pt[] {
  let out = thin(points, STORE_MIN_STEP);
  if (out.length > MAX_POINTS) {
    const step = (out.length - 1) / (MAX_POINTS - 1);
    out = Array.from({ length: MAX_POINTS }, (_, i) => out[Math.round(i * step)]);
  }
  return out;
}

const flatten = (pts: Pt[], toX: (x: number) => number, toY: (y: number) => number): number[] => pts.flatMap((p) => [round4(toX(p.x)), round4(toY(p.y))]);

// 그림 층 안의 화면 좌표 → 낙서로 저장
export function toFreeStroke(base: { id: string; color: string; width: number }, points: Pt[], layer: { width: number; height: number }): InkStroke {
  return { ...base, pts: flatten(thinForStorage(points), (x) => x / layer.width, (y) => y / layer.height) };
}

// 그림 층 안의 화면 좌표 → 상품 칸에 붙은 획으로 저장. box는 같은 좌표계에서 잰 그 칸의 위치와 크기.
export function toAnchoredStroke(base: { id: string; color: string; width: number }, points: Pt[], anchor: string, box: Box): InkStroke {
  return { ...base, anchor, pts: flatten(thinForStorage(points), (x) => (x - box.left) / box.width, (y) => (y - box.top) / box.height) };
}

// 저장된 획 → 지금 화면 좌표. 칸에 붙은 획인데 그 칸이 지금 화면에 없으면 null(그리지 않고 보관만 한다).
export function resolvePoints(stroke: InkStroke, layer: { width: number; height: number }, anchorBox?: Box | null): Pt[] | null {
  let toX: (u: number) => number;
  let toY: (v: number) => number;
  if (stroke.anchor !== undefined) {
    if (!anchorBox) return null;
    toX = (u) => anchorBox.left + u * anchorBox.width;
    toY = (v) => anchorBox.top + v * anchorBox.height;
  } else {
    toX = (u) => u * layer.width;
    toY = (v) => v * layer.height;
  }
  const out: Pt[] = [];
  for (let i = 0; i + 1 < stroke.pts.length; i += 2) out.push({ x: toX(stroke.pts[i]), y: toY(stroke.pts[i + 1]) });
  return out;
}

// 서버(또는 어디서든)에서 읽은 획 목록을 검증한다. 모양이 틀리거나 망가진 획은 버리고, 읽을 수 없으면 빈 목록이다(그림이 없어질 뿐 화면은 멈추지 않는다).
// 서버가 저장하기 전에 한 번, 화면이 읽은 뒤에 한 번 같은 규칙으로 거른다.
export function parseInkStrokes(data: unknown): InkStroke[] {
  if (!Array.isArray(data)) return [];
  const out: InkStroke[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    const pts = s.pts;
    if (typeof s.id !== 'string' || typeof s.color !== 'string' || !COLOR.test(s.color)) continue;
    if (typeof s.width !== 'number' || !Number.isFinite(s.width) || s.width < 0.5 || s.width > 64) continue;
    if (!Array.isArray(pts) || pts.length < 4 || pts.length % 2 !== 0 || pts.length > MAX_POINTS * 2 || !pts.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    if (s.anchor !== undefined && typeof s.anchor !== 'string') continue;
    out.push({ id: s.id, color: s.color, width: s.width, pts: pts as number[], ...(typeof s.anchor === 'string' ? { anchor: s.anchor } : {}) });
  }
  return out.slice(-MAX_STROKES);
}

// 서버 보관 기간: 오늘을 포함해 3일(오늘·어제·그제). 이 날짜보다 이전 그림은 지운다(YYYY-MM-DD 문자열 비교로 충분하다).
export const INK_KEEP_DAYS = 3;
export function inkCutoffDate(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (INK_KEEP_DAYS - 1));
  return d.toISOString().slice(0, 10);
}
