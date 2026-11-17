// 펜 그림의 저장 형식과 좌표 변환(순수 함수). 이 기기(localStorage)에 날짜·모니터별로 저장하고, 새로고침해도 남는다.
//
// 좌표 두 종류:
// - 낙서(anchor 없음): 그림 층 크기에 대한 비율(0~1). 화면 크기가 달라져도 위치가 맞는다.
// - 상품 칸에 붙은 획(anchor = 상품 id): 그 칸의 크기에 대한 비율. 칸이 움직이거나 열 폭이 바뀌어도 따라간다.
// - 줄에 붙은 획(anchor = `row:카드 id`): 그 줄 전체 크기에 대한 비율. 줄 안 열 폭이 화면마다 달라 같은 비율이 다른 칸에 떨어지므로(2026-11-17),
//   새로 쓰는 줄 획에는 쓸 때의 줄 폭과 열(grid 트랙) 폭 `lay`를 함께 저장하고, 다시 그릴 때 열 단위로 환산한다(remapX). pts의 뜻(줄 폭 비율)은 바꾸지 않는다.
import type { Pt } from './canvas.ts';
import { thin } from './gesture.ts';

export interface InkStroke {
  id: string;
  color: string;
  width: number; // CSS px
  pts: number[]; // [x0, y0, x1, y1, ...]
  anchor?: string; // 붙은 상품 id
  lay?: RowLayout; // 줄 획만: 쓸 때의 줄 레이아웃. 없으면(옛 획) pts를 줄 폭 비율 그대로 쓴다
}

// 줄 레이아웃: w = 줄 요소 폭(배율 적용 전 CSS px), t = grid 열(트랙) 폭들(같은 px). 열은 왼쪽부터 이어 붙어 있다.
export interface RowLayout {
  w: number;
  t: number[];
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
// lay는 줄 획에만 준다(줄 레이아웃을 쟀을 때). 없으면 lay 키 없이 예전과 똑같이 저장한다.
export function toAnchoredStroke(base: { id: string; color: string; width: number }, points: Pt[], anchor: string, box: Box, lay?: RowLayout): InkStroke {
  return { ...base, anchor, pts: flatten(thinForStorage(points), (x) => (x - box.left) / box.width, (y) => (y - box.top) / box.height), ...(lay ? { lay } : {}) };
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

export const MAX_LAYOUT_TRACKS = 64;
const MAX_LAYOUT_WIDTH = 100_000; // 줄 폭 상한(px). 이보다 크면 잘못 잰 값이다
const REMAP_MARGIN = 0.5; // 환산한 x가 줄 폭 기준으로 이만큼(좌우) 밖까지만 허용한다
const round2 = (n: number) => Math.round(n * 100) / 100;

// 저장된 lay 검증: w는 양의 유한수, t는 길이 1~64의 비음수 유한수 배열이고 합이 w+1 이하여야 한다. 틀리면 undefined.
export function parseRowLayout(data: unknown): RowLayout | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { w, t } = data as Record<string, unknown>;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > MAX_LAYOUT_WIDTH) return undefined;
  if (!Array.isArray(t) || t.length < 1 || t.length > MAX_LAYOUT_TRACKS) return undefined;
  let total = 0;
  for (const n of t) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
    total += n;
  }
  if (total > w + 1) return undefined;
  return { w, t: (t as number[]).slice() };
}

// 브라우저가 돌려준 computed `grid-template-columns`("40px 64px 144px ...")와 줄 요소 폭(배율 전 px)에서 줄 레이아웃을 만든다.
// px가 아닌 값(auto·이름 있는 선·none)이 섞여 있거나 열 폭이 0·NaN이거나 열 합이 줄 폭을 넘으면 null(쓰지 않고 예전처럼 저장한다).
export function rowLayoutFrom(gridTemplateColumns: string, rowWidth: number): RowLayout | null {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return null;
  const parts = gridTemplateColumns.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > MAX_LAYOUT_TRACKS) return null;
  const t: number[] = [];
  for (const part of parts) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(part);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    t.push(round2(n));
  }
  return parseRowLayout({ w: round2(rowWidth), t }) ?? null;
}

// 지금 레이아웃으로 환산할 수 있는가: 열 수가 저장 때와 같고, 지금 열 폭과 줄 폭이 모두 양의 유한수여야 한다. 아니면 환산하지 않는다(예전처럼 줄 폭 비율 그대로).
function canRemap(lay: RowLayout, curTracks: readonly number[], curW: number): boolean {
  if (!(Number.isFinite(curW) && curW > 0 && Number.isFinite(lay.w) && lay.w > 0)) return false;
  if (curTracks.length !== lay.t.length || curTracks.length === 0) return false;
  return curTracks.every((n) => Number.isFinite(n) && n > 0) && lay.t.every((n) => Number.isFinite(n) && n >= 0);
}

const sameLayout = (lay: RowLayout, cur: RowLayout) => lay.w === cur.w && lay.t.length === cur.t.length && lay.t.every((n, i) => n === cur.t[i]);

// 쓸 때 줄 폭 비율 u로 저장된 x를 지금 레이아웃의 줄 폭 비율로 바꾼다. 쓸 때 속한 열 안의 상대 위치를 지금 같은 열 안에 놓는다.
// 열 오른쪽 바깥은 열 끝에서의 거리를, x<0은 px 위치를 그대로 둔다. 결과는 줄 폭 ± REMAP_MARGIN 안으로 자른다.
// 환산할 수 없으면(열 수가 다르다·열 폭이 0·NaN) 원래 u를 그대로 돌려준다.
export function remapX(u: number, lay: RowLayout, curTracks: readonly number[], curW: number): number {
  if (!Number.isFinite(u) || !canRemap(lay, curTracks, curW)) return u;
  const x = u * lay.w;
  let out: number;
  const storedEnd = lay.t.reduce((s, n) => s + n, 0);
  const curEnd = curTracks.reduce((s, n) => s + n, 0);
  if (x < 0) {
    out = x;
  } else if (x >= storedEnd) {
    out = curEnd + (x - storedEnd);
  } else {
    let storedStart = 0;
    let curStart = 0;
    out = curEnd; // 아래 반복에서 반드시 찾는다(x < storedEnd). 부동소수 오차로 못 찾는 경우를 위한 안전값
    for (let i = 0; i < lay.t.length; i++) {
      if (x < storedStart + lay.t[i]) {
        out = curStart + ((x - storedStart) / lay.t[i]) * curTracks[i];
        break;
      }
      storedStart += lay.t[i];
      curStart += curTracks[i];
    }
  }
  out = Math.min(Math.max(out, -REMAP_MARGIN * curW), (1 + REMAP_MARGIN) * curW);
  return out / curW;
}

// 줄 획 하나를 지금 줄 레이아웃에 맞춰 환산한 획(x만 바뀐다). lay가 없거나 지금 레이아웃을 모르거나 환산할 수 없거나 레이아웃이 같으면 같은 획 객체를 그대로 돌려준다.
// 환산했으면 pts가 지금 레이아웃 기준이므로 lay도 지금 것으로 바꾼다(지우개 조각이 이 값을 이어받는다).
export function remapStroke(stroke: InkStroke, cur: RowLayout | null | undefined): InkStroke {
  const lay = stroke.lay;
  if (!lay || !cur || !canRemap(lay, cur.t, cur.w) || sameLayout(lay, cur)) return stroke;
  const pts = stroke.pts.slice();
  for (let i = 0; i < pts.length; i += 2) pts[i] = remapX(pts[i], lay, cur.t, cur.w);
  return { ...stroke, pts, lay: { w: cur.w, t: cur.t.slice() } };
}

// 지우개가 획을 자른 조각을 저장 획으로 만든다. shown은 지금 화면에 보이는 모양의 획(remapStroke 결과)이라 조각의 lay도 그 획의 lay를 이어받는다.
export function toPieceStroke(base: { id: string; color: string; width: number }, piece: Pt[], shown: InkStroke, box: Box | null | undefined, layer: { width: number; height: number }): InkStroke {
  return shown.anchor !== undefined && box ? toAnchoredStroke(base, piece, shown.anchor, box, shown.lay) : toFreeStroke(base, piece, layer);
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
    const lay = parseRowLayout(s.lay); // 망가진 lay는 lay만 버리고 획은 둔다(옛 획처럼 줄 폭 비율로 그린다)
    out.push({ id: s.id, color: s.color, width: s.width, pts: pts as number[], ...(typeof s.anchor === 'string' ? { anchor: s.anchor } : {}), ...(lay ? { lay } : {}) });
  }
  return out.slice(-MAX_STROKES);
}

// 서버 보관 기간: 마지막으로 그린(저장한) 뒤 3일. 이보다 오래 손대지 않은 그림은 지운다.
// 주문 날짜가 아니라 저장 시각(updated_at) 기준이다: 주문 날짜로 자르면 과거 날짜 화면(예: 11/14에 11/1을 열어 시험)에서 그린 그림이
// 저장되자마자 "오래된 그림"으로 지워져서 다른 PC에 보이지 않고 새로고침하면 사라졌다(2026-11-14).
export const INK_KEEP_DAYS = 3;
export function inkCutoffTime(now: Date): string {
  return new Date(now.getTime() - INK_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
