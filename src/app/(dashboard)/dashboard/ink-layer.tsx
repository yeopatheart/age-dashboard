'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, GripHorizontal, PenLine, Trash2, Undo2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchBoardInk, fetchBoardInkStamp, subscribeBoardInk } from '@/lib/ink/board-ink-client';
import { clearCanvas, drawPath, endInk, extendInk, fitCanvas, needsFit, redrawLive, startInk, type LiveInk, type Pt } from '@/lib/ink/canvas';
import { eraseStroke } from '@/lib/ink/erase';
import { classifyStroke, pathLength, REASON_LABEL, startsTwoFingerTap, TWO_FINGER } from '@/lib/ink/gesture';
import { popHistory, pushHistory, type HistoryEntry } from '@/lib/ink/history';
import { barLayout, cardPosition, clampBar, type BarSpec } from '@/lib/ink/menu-layout';
import { useLongPress } from '@/lib/use-long-press';
import { anchorLegacyStrokes, pickRowAnchor } from '@/lib/ink/row-anchor';
import { chipTargets, isProductAnchor, isSumAnchor, pickSumAnchor, sumAnchor } from '@/lib/ink/summary-anchor';
import { limitInkStrokes, MAX_STROKES, remapStroke, resolvePoints, rowLayoutFrom, STORE_MIN_STEP, toAnchoredStroke, toFreeStroke, toPieceStroke, type Box, type InkStroke, type RowLayout } from '@/lib/ink/store';
import { saveBoardInk } from './actions';

// 칠판 펜 기능의 그림 층: 주문표 위에 얹는 캔버스 + 세로 한 줄 도구 묶음(펜·지우개·되돌리기).
// 확정 설계는 docs/decisions/2026-11-14-board-pen-feature.md(2026-11-22 변경: 도구 묶음). 요약:
// - 도구 버튼은 처음부터 세로 한 줄로 보인다. 펜을 누르면 켜기/끄기, 지우개를 누르면 지우개(다시 누르면 펜으로 복귀), 되돌리기는 누르면 바로 된다.
//   펜·지우개는 길게 누르면 설정 카드(펜: 색·굵기, 지우개: 크기·전체 지우기)가 열린다. 맨 위 손잡이를 끌면 묶음 전체가 움직인다.
//   색·굵기·지우개 크기는 한 번 정하면 계속 쓰므로, 설정 카드는 설정할 때만 뜨고 그리기 시작하면 닫힌다(2026-11-14 현장 요청).
// - 펜·손가락·지우개가 모두 touch로 들어오므로(진단 결과) 도구 선택으로 구분하고, 손바닥은 접촉 크기로 거른다.
// - 동그라미·직선은 해당 상품 칸을 포장 완료로 올리고(뒤에서 처리, 표시 없음), 그 획은 상품 칸에 붙는다. 시험 모드(&ink=dry)는 결과만 보여 준다.
// - 되돌리기는 포장 완료도 되돌린다. 지우개가 동그라미·직선을 지우면 그 상품의 포장 완료도 원복한다(예전에 한 것도 포함, 되돌리기로 복구하면 다시 포장 완료로 올린다).
//   전체 지우기는 그림만 지우고 포장 상태는 유지한다.

const PALM_PX = 24; // 진단: 손가락·펜 1×1px, 손바닥 52×62px
// 도구 묶음: 손잡이 + 버튼 지름 40px(예전 플로팅 버튼 45px에서 한 번 더 줄였다 — 버튼이 늘어도 주문 목록을 덜 가리게, 2026-11-22).
const BAR: BarSpec = { button: 40, gap: 6, handle: 22 };
const BAR_BUTTONS = 3; // 펜·지우개·되돌리기
const BAR_SIZE = barLayout({ x: 0, y: 0 }, BAR_BUTTONS, BAR); // 묶음 크기(위치와 상관없다)
const CARD_W = 264;
const COLORS = [
  { name: '빨강', hex: '#dc2626' },
  { name: '파랑', hex: '#2563eb' },
  { name: '검정', hex: '#111827' },
  { name: '초록', hex: '#16a34a' },
  { name: '주황', hex: '#ea580c' },
] as const;
const PEN_RANGE = { min: 1, max: 24 };
const ERASER_RANGE = { min: 8, max: 120 };
const PREFS_KEY = 'board-ink-prefs';
const POS_KEY = 'board-ink-bar-pos'; // 도구 묶음의 가운데 위치(화면 비율). 예전 플로팅 버튼 위치('board-ink-pos')와는 기준이 달라 따로 둔다.
const NOTE_MS = 6000;
const SAVE_DELAY_MS = 500; // 그린 뒤 이 시간 안의 변경은 한 번의 저장으로 묶는다
const LEGACY_SETTLE_MS = 2000; // 예전 필기를 줄에 붙이거나 다른 모니터에서 넘어온 필기를 가져오기 전에 줄 위치가 이 시간 동안 더 바뀌지 않기를 기다린다(표 높이·글꼴이 자리잡는 중에 붙이면 엉뚱한 줄에 붙는다)

type Tool = 'pen' | 'eraser';
interface Prefs {
  color: string;
  penWidth: number;
  eraserSize: number;
}
// 지우개 기본 크기는 반지름 16px(지름 32px ≈ 칸 높이): 지우개가 닿으면 그 동그라미의 포장 완료도 원복되므로, 이웃 칸의 동그라미까지 닿지 않게 작게 시작한다.
const DEFAULT_PREFS: Prefs = { color: COLORS[0].hex, penWidth: 4, eraserSize: 16 };

export interface InkItem {
  id: string;
  isPacked: boolean;
  cancelled: boolean;
  label: string; // 시험 모드 결과에 보일 이름("업체 상품")
}

interface InkState {
  strokes: InkStroke[];
  history: HistoryEntry<InkStroke[]>[];
}

interface ActiveStroke {
  pointerId: number;
  tool: Tool;
  points: Pt[];
  cursor: LiveInk;
  tail: Pt | null; // 받았지만 앞 점과 너무 가까워(STORE_MIN_STEP) 아직 쓰지 않은 마지막 점. 획이 끝날 때 마지막 점으로 붙인다.
  before: InkStroke[];
  boxes: Map<string, Box>; // 지우개는 시작할 때 재 둔다. 펜은 획이 끝날 때 잰다(쓰는 동안 레이아웃을 강제로 읽지 않으려고)
  layouts: Map<string, RowLayout>; // 지우개가 시작할 때 잰, lay가 있는 획이 붙은 줄의 지금 열 레이아웃(없으면 비어 있다)
  origin: Pt; // 획을 시작할 때 잰 그림 층의 화면 위 왼쪽 위(획 도중 점마다 다시 재지 않는다)
  layer: { width: number; height: number };
  touched: Set<string>; // 지우개가 닿은(잘라 낸) 획에 붙어 있던 상품 id
  startedAt: number; // 닿은 시각(이벤트 timeStamp) — 두 번째 손가락이 곧바로 닿았는지(두 손가락 탭) 가리는 데 쓴다
  pointerType: string;
}


const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      color: COLORS.some((c) => c.hex === raw?.color) ? (raw?.color as string) : DEFAULT_PREFS.color,
      penWidth: clamp(Number(raw?.penWidth) || DEFAULT_PREFS.penWidth, PEN_RANGE.min, PEN_RANGE.max),
      eraserSize: clamp(Number(raw?.eraserSize) || DEFAULT_PREFS.eraserSize, ERASER_RANGE.min, ERASER_RANGE.max),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// 처음엔 화면 오른쪽 가장자리, 세로 가운데에 둔다(손이 닿기 쉽고 설정 카드는 왼쪽에 뜬다).
function defaultPos(): Pt {
  return clampBar({ x: window.innerWidth - 40, y: window.innerHeight / 2 }, BAR_SIZE, { width: window.innerWidth, height: window.innerHeight });
}

function loadPos(): Pt {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { fx?: number; fy?: number } | null;
    if (typeof raw?.fx === 'number' && typeof raw.fy === 'number') return clampBar({ x: raw.fx * window.innerWidth, y: raw.fy * window.innerHeight }, BAR_SIZE, { width: window.innerWidth, height: window.innerHeight });
  } catch {
    // 저장된 위치가 없거나 읽을 수 없으면 기본 위치
  }
  return defaultPos();
}

// 그림 층(캔버스) 기준으로 잰 화면 위 상품 칸과 줄·패널 칩의 위치. 칸은 `data-chip="상품 id"`, 줄은 `data-ink-row="업체 카드 id"`(키는 `row:카드 id`),
// 모니터 2의 품목별 수량 패널 칩은 `data-summary-chip="품목 키"`(키는 `sum:품목 키`)로 찾는다.
// 획은 시작한 줄·패널 칩(또는 동그라미·직선으로 표시한 상품 칸)에 붙어서 칸·줄·칩의 크기가 바뀌거나 위치가 움직여도 따라간다.
function anchorBoxes(canvas: HTMLCanvasElement): Map<string, Box> {
  const layer = canvas.getBoundingClientRect();
  const out = new Map<string, Box>();
  const measure = (el: HTMLElement, key: string | undefined) => {
    if (!key || el.closest('[data-ink-ignore]')) return; // 화면 밖에 숨겨 둔 행(별도 주문 팝업의 다른 쪽)의 칸은 이 화면의 그림 대상이 아니다
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.set(key, { left: r.left - layer.left, top: r.top - layer.top, width: r.width, height: r.height });
  };
  canvas.parentElement?.querySelectorAll<HTMLElement>('[data-chip]').forEach((el) => measure(el, el.dataset.chip));
  canvas.parentElement?.querySelectorAll<HTMLElement>('[data-ink-row]').forEach((el) => measure(el, el.dataset.inkRow ? `row:${el.dataset.inkRow}` : undefined));
  canvas.parentElement?.querySelectorAll<HTMLElement>('[data-summary-chip]').forEach((el) => measure(el, el.dataset.summaryChip ? sumAnchor(el.dataset.summaryChip) : undefined));
  return out;
}

// 줄의 열(grid 트랙) 레이아웃: 줄 폭은 배율 전 px(offsetWidth)이고 열 폭은 computed grid-template-columns다. 같은 단위라 배율이 걸린 화면에서도 비율로만 계산된다.
// 잴 수 없으면(px가 아닌 값·0·NaN·열 합이 줄 폭보다 큼·예외) 그 줄은 빠진다 — 쓸 때는 lay 없이 저장하고, 그릴 때는 환산하지 않는다. 어떤 예외도 밖으로 내보내지 않는다.
function measureRowLayouts(canvas: HTMLCanvasElement, keys: ReadonlySet<string>): Map<string, RowLayout> {
  const out = new Map<string, RowLayout>();
  if (keys.size === 0) return out;
  try {
    canvas.parentElement?.querySelectorAll<HTMLElement>('[data-ink-row]').forEach((el) => {
      const key = el.dataset.inkRow ? `row:${el.dataset.inkRow}` : undefined;
      if (!key || !keys.has(key) || el.closest('[data-ink-ignore]')) return;
      const lay = rowLayoutFrom(getComputedStyle(el).gridTemplateColumns, el.offsetWidth);
      if (lay) out.set(key, lay);
    });
  } catch {
    // 측정에 실패하면 그 줄은 환산 없이 예전 방식으로 쓰고 그린다
  }
  return out;
}

// lay가 있는 획이 붙은 줄들의 지금 열 레이아웃. lay가 있는 획이 하나도 없으면 DOM을 읽지 않는다.
function measureStrokeLayouts(canvas: HTMLCanvasElement, strokes: readonly InkStroke[]): Map<string, RowLayout> {
  const keys = new Set<string>();
  for (const stroke of strokes) if (stroke.lay && stroke.anchor !== undefined) keys.add(stroke.anchor);
  return measureRowLayouts(canvas, keys);
}

// 다른 모니터에서 이 모니터로 복사해 온 획의 id(이 기기의 localStorage, 날짜·모니터별). 복사한 뒤 지운 획이 다시 복사되지 않게 한다.
const migratedKey = (date: string, monitor: string) => `board-ink-migrated:${date}:${monitor}`;
function loadMigrated(date: string, monitor: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(migratedKey(date, monitor)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
function saveMigrated(date: string, monitor: string, ids: string[]) {
  try {
    // 기억하는 id는 두 모니터 몫(2 × 획 상한)까지. 이보다 적게 기억하면 지운 획이 다음 복사 때 되살아난다.
    localStorage.setItem(migratedKey(date, monitor), JSON.stringify(ids.slice(-2 * MAX_STROKES)));
  } catch {
    // 저장이 막혀 있으면 기억하지 못한다(지운 획이 한 번 되살아날 수 있을 뿐이다)
  }
}

interface Props {
  date: string;
  monitor: string;
  dry: boolean;
  items: InkItem[];
  onPack: (itemId: string) => void;
  onUnpack: (itemId: string) => void;
  // 펜(또는 지우개)이 켜지고 꺼질 때 알린다. 켜져 있는 동안이 "칠판 모드"(카드 탭이 막힌다)이고 꺼지면 일반 모드다.
  onActiveChange: (active: boolean) => void;
  // true면 그림만 보여 준다(PC): 버튼·입력 없이 캔버스가 터치·마우스를 그대로 통과시키고, 서버의 그림이 바뀌면 다시 읽어 그린다.
  viewOnly?: boolean;
  // 줄 높이·줄 구성·열 폭이 바뀌면 달라지는 값. 바뀌면 줄에 붙은 필기를 바뀐 위치에 다시 그린다.
  layoutKey?: string;
  chipLayoutKey?: string; // 모니터 2 패널 칩의 배치 서명. 달라지면 칩에 붙은 필기를 다시 그린다(줄 구성 키와 달리 다른 모니터 필기 복사는 일으키지 않는다)
  // 줄 위치를 다 쟀다(표 높이 측정이 끝났다). 이때부터 예전 방식(그림 층 비율)으로 저장된 필기를 줄에 붙인다.
  ready?: boolean;
  // 기준 화면(board-stage)에 걸린 배율(PC). 바뀌면 다시 그려서 그림 해상도를 새 크기에 맞춘다. 배율이 없는 곳(칠판·별도 주문 팝업)은 생략한다.
  scale?: number;
}

export function InkLayer({ date, monitor, dry, items, onPack, onUnpack, onActiveChange, viewOnly = false, layoutKey = '', chipLayoutKey = '', ready = false, scale: stageScale = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<InkState>(() => ({ strokes: [], history: [] }));
  const stateRef = useRef(state);
  const [tool, setTool] = useState<Tool | null>(null); // 그리는 중인 도구(없으면 터치가 그대로 통과한다)
  const [card, setCard] = useState<Tool | null>(null); // 설정 카드(펜: 색·굵기, 지우개: 크기·전체 지우기). 펜·지우개를 길게 누르면 열리고, 그리기 시작하면 닫힌다.
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [pos, setPos] = useState<Pt>(loadPos);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [layoutTick, setLayoutTick] = useState(0);
  const [note, setNote] = useState<{ text: string; x: number; y: number } | null>(null);

  const toolRef = useRef<Tool | null>(null);
  const prefsRef = useRef(prefs);
  const itemsRef = useRef(items);
  const activeRef = useRef<ActiveStroke | null>(null);
  const idCounter = useRef(0);
  const redrawFrame = useRef(0);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null); // 손잡이를 끄는 중

  useEffect(() => {
    toolRef.current = tool;
    prefsRef.current = prefs;
    itemsRef.current = items;
  });

  // 펜이 켜져 있는 동안만 칠판 모드다. 이 컴포넌트가 사라질 때(모니터·날짜 전환)도 꺼진 것으로 알린다.
  const penOn = tool !== null;
  useEffect(() => {
    onActiveChange(penOn);
    return () => onActiveChange(false);
  }, [penOn, onActiveChange]);

  // 그림은 서버가 원본이다(날짜·모니터당 한 행). 처음 한 번 읽고, 보기 전용(PC)은 서버 그림이 바뀌었다는 신호가 올 때마다 다시 읽는다.
  // 그리는 쪽은 이미 그리기 시작했으면(자기 그림이 더 최신이다) 읽은 것으로 덮지 않는다.
  const committedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    // 마지막으로 읽은 그림의 저장 시각. 안전 주기('poll')에서는 이 값이 그대로면 획 전체를 다시 받지 않는다.
    let stamp: string | null | undefined;
    const load = async (reason: 'signal' | 'poll' = 'signal') => {
      if (reason === 'poll' && stamp !== undefined) {
        const latest = await fetchBoardInkStamp(supabase, date, monitor);
        if (cancelled || latest === undefined || latest === stamp) return;
      }
      const ink = await fetchBoardInk(supabase, date, monitor);
      if (cancelled || ink === null) return;
      stamp = ink.updatedAt;
      if (!viewOnly && committedRef.current) return;
      const next = { strokes: ink.strokes, history: [] as InkState['history'] };
      stateRef.current = next;
      setState(next);
    };
    void load();
    if (!viewOnly) return () => { cancelled = true; };
    const unsubscribe = subscribeBoardInk(supabase, date, (reason) => void load(reason));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [date, monitor, viewOnly]);

  // 저장: 그리거나 지울 때마다 0.5초 안의 변경을 묶어 최신 전체를 서버에 보낸다. 시험 모드(&ink=dry)는 서버에 저장하지 않는다.
  // 실패하면 화면에 "저장 안 됨"을 띄우고(눌러서 다시 시도), 다음 변경 때도 다시 보낸다. 화면을 떠날 때(모니터·날짜 전환) 남은 변경은 바로 보낸다.
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const flushSave = async () => {
    clearTimeout(saveTimer.current);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const { error } = await saveBoardInk(date, monitor, limitInkStrokes(stateRef.current.strokes));
    if (error) {
      dirtyRef.current = true;
      setSaveError(error);
    } else {
      setSaveError(null);
    }
  };
  const scheduleSave = () => {
    if (dry) return;
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), SAVE_DELAY_MS);
  };
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (dirtyRef.current) void saveBoardInk(date, monitor, limitInkStrokes(stateRef.current.strokes));
    },
    [date, monitor],
  );

  const newId = () => `${Date.now().toString(36)}${(idCounter.current++).toString(36)}`;

  const commit = (next: InkState) => {
    stateRef.current = next;
    setState(next);
    committedRef.current = true;
    scheduleSave();
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const layer = canvas.getBoundingClientRect();
    // 기준 화면(PC)의 배율이 바뀌면 ResizeObserver가 발동하지 않아 그림 해상도가 옛 크기로 남는다. 그 위에 새 rect 기준 좌표를 그리면 필기가 가로·세로로 어긋나므로,
    // 그릴 때마다 해상도가 지금 rect와 맞는지 보고 다르면 다시 잡는다(같은 ctx가 그대로 쓰이고, 변환·선 모양은 fitCanvas가 다시 건다). 칠판(배율 1)은 항상 맞아서 건너뛴다.
    if (needsFit(canvas.width, canvas.height, layer.width, layer.height, window.devicePixelRatio || 1)) fitCanvas(canvas);
    clearCanvas(ctx);
    // 상품 칸에 붙은 획이 하나라도 있을 때만 칸 위치를 잰다(칸마다 위치를 재는 것은 강제 레이아웃이라, 낙서뿐일 때는 건너뛴다).
    const strokes = stateRef.current.strokes;
    const boxes = strokes.some((stroke) => stroke.anchor !== undefined) ? anchorBoxes(canvas) : new Map<string, Box>();
    // 배율이 걸린 기준 화면(PC)에서는 선 굵기도 같은 배율로 그려서 칠판과 같은 모양으로 보이게 한다(칠판은 배율 1).
    const scale = canvas.offsetWidth > 0 ? layer.width / canvas.offsetWidth : 1;
    // 쓸 때의 열 레이아웃(lay)이 있는 줄 획은 지금 줄의 열 레이아웃으로 환산해서 같은 칸 안에 그린다. lay가 없는 획은 DOM을 더 읽지 않고 예전과 같다.
    const layouts = measureStrokeLayouts(canvas, strokes);
    for (const raw of strokes) {
      const stroke = raw.lay && raw.anchor !== undefined ? remapStroke(raw, layouts.get(raw.anchor)) : raw;
      const points = resolvePoints(stroke, { width: layer.width, height: layer.height }, stroke.anchor !== undefined ? boxes.get(stroke.anchor) ?? null : undefined);
      if (!points || points.length < 2) continue; // 붙은 상품 칸이 지금 화면에 없으면 그리지 않고 보관만 한다
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width * scale;
      drawPath(ctx, points);
    }
    // 쓰는 도중에 전체를 다시 그리면(데이터 갱신 등) 쓰던 획도 같이 지워지므로 그려 둔 구간까지 복원한다.
    const live = activeRef.current;
    if (live?.tool === 'pen') {
      ctx.strokeStyle = prefsRef.current.color;
      ctx.fillStyle = prefsRef.current.color;
      ctx.lineWidth = prefsRef.current.penWidth;
      redrawLive(ctx, live.cursor);
    }
  };

  const scheduleRedraw = () => {
    cancelAnimationFrame(redrawFrame.current);
    redrawFrame.current = requestAnimationFrame(redraw);
  };

  // 화면 크기에 맞춰 캔버스 해상도를 다시 잡는다(크기를 바꾸면 그림이 지워지므로 저장된 획을 다시 그린다).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fitCanvas(canvas);
    const observer = new ResizeObserver(() => {
      fitCanvas(canvas);
      setLayoutTick((t) => t + 1);
    });
    observer.observe(canvas);
    // 안쪽 목록이 스크롤되면(별도 주문 팝업) 상품 칸이 움직이므로 상품 칸에 붙은 획을 다시 그린다.
    // 스크롤 이벤트는 프레임보다 자주 오므로 프레임당 한 번만 다시 그리게 모은다(이벤트마다 상태를 바꾸면 그때마다 전체를 다시 그렸다).
    const parent = canvas.parentElement;
    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        setLayoutTick((t) => t + 1);
      });
    };
    parent?.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(scrollFrame);
      parent?.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  // 그림, 상품 데이터, 레이아웃이 바뀌면 다시 그린다(상품 칸이 움직이면 붙은 획이 따라간다).
  // items는 서버 데이터를 받을 때마다 새 배열이 되므로 참조가 아니라 상품 줄의 구성(id·취소 여부)이 바뀔 때만 다시 그린다(내용이 같은 갱신마다 캔버스를 지우지 않는다).
  const itemsKey = items.map((i) => `${i.id}${i.cancelled ? 'x' : ''}`).join(',');
  const skipRedraw = useRef(false);
  useLayoutEffect(() => {
    if (skipRedraw.current) {
      skipRedraw.current = false;
      return;
    }
    redraw();
  }, [state.strokes, itemsKey, layoutTick, layoutKey, chipLayoutKey, stageScale]);

  // 그리는 쪽(칠판)이 필기를 정리한다. 줄 위치가 2초 동안 안정된 뒤 한 번에 처리해서 한 번만 저장한다.
  // (1) 예전 방식(그림 층 비율)으로 저장된 필기를 지금 보이는 줄에 붙인다: 보이는 위치는 그대로이고 저장 방식만 바뀌어서, 그 뒤로는 줄이 커지거나 움직여도 따라간다. 줄 밖의 필기는 그대로 둔다.
  // (2) 주문이 늘어 줄이 다른 모니터로 넘어오면(모니터 1의 줄 수가 늘면 모니터 2의 앞쪽 줄이 모니터 1로 온다) 그 줄에 붙은 필기는 다른 모니터의 저장본에 있어서 안 보인다.
  //     줄 구성이 바뀔 때마다 다른 모니터의 저장본을 읽어, 지금 이 모니터에 보이는 줄·칸에 붙은 필기를 이 모니터의 저장본으로 복사한다.
  //     한 번 복사한 획의 id는 이 기기에 기억해서, 그 뒤에 지운 획이 되살아나지 않게 한다. 다른 모니터의 저장본은 건드리지 않는다(칠판 두 대가 각자 자기 저장본만 쓴다).
  // 칠판 화면이 기준이라 지금 보이는 위치가 곧 쓴 위치다.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mergedKeyRef = useRef<string | null>(null);
  const otherMonitor = monitor === '1' ? '2' : monitor === '2' ? '1' : null;
  useEffect(() => {
    clearTimeout(settleTimer.current);
    if (viewOnly || dry || !ready) return;
    const needsLegacy = state.strokes.some((stroke) => stroke.anchor === undefined);
    const needsMerge = otherMonitor !== null && mergedKeyRef.current !== layoutKey;
    if (!needsLegacy && !needsMerge) return;
    let cancelled = false;
    const run = async () => {
      if (cancelled || !canvasRef.current) return;
      if (activeRef.current) {
        settleTimer.current = setTimeout(() => void run(), 1000); // 쓰는 중이면 끝난 뒤에
        return;
      }
      let foreign: InkStroke[] | null = null;
      if (needsMerge && otherMonitor) foreign = (await fetchBoardInk(createClient(), date, otherMonitor))?.strokes ?? null;
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      if (activeRef.current) {
        settleTimer.current = setTimeout(() => void run(), 1000);
        return;
      }
      const cur = stateRef.current;
      const layer = canvas.getBoundingClientRect();
      const boxes = anchorBoxes(canvas);
      let next = anchorLegacyStrokes(cur.strokes, { width: layer.width, height: layer.height }, boxes);
      if (foreign) {
        mergedKeyRef.current = layoutKey;
        const known = loadMigrated(date, monitor);
        const own = new Set(next.map((stroke) => stroke.id));
        const incoming = foreign.filter((stroke) => stroke.anchor !== undefined && !isSumAnchor(stroke.anchor) && boxes.has(stroke.anchor) && !own.has(stroke.id) && !known.has(stroke.id));
        if (incoming.length > 0) {
          next = [...next, ...incoming];
          saveMigrated(date, monitor, [...known, ...incoming.map((stroke) => stroke.id)]);
        }
      }
      if (next !== cur.strokes) commit({ strokes: next, history: cur.history });
    };
    settleTimer.current = setTimeout(() => void run(), LEGACY_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(settleTimer.current);
    };
    // commit은 매 렌더 새로 만들어지지만 ref만 쓰므로 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.strokes, layoutTick, layoutKey, ready, viewOnly, dry, date, monitor, otherMonitor]);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(redrawFrame.current);
      clearTimeout(noteTimer.current);
    },
    [],
  );

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // 저장이 막혀 있으면 이 화면에서만 바뀐다
    }
  };

  const showNote = (text: string, at: Pt) => {
    setNote({ text, x: at.x, y: at.y });
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  };

  const closeCard = () => setCard(null);

  // ── 입력 ──────────────────────────────────────────────────────────────────
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const movePreview = (p: Pt | null) => {
    const el = previewRef.current;
    if (!el) return;
    if (!p) {
      el.style.display = 'none';
      return;
    }
    const size = prefsRef.current.eraserSize * 2;
    el.style.display = 'block';
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
  };

  // 지우개 원 안의 부분을 모든 획에서 잘라 낸다. 칸에 붙은 획도 지금 화면 좌표로 바꿔 지우고 다시 칸 기준으로 저장한다.
  const applyErase = (center: Pt, active: ActiveStroke) => {
    const radius = prefsRef.current.eraserSize;
    let changed = false;
    const next: InkStroke[] = [];
    for (const stroke of stateRef.current.strokes) {
      // 줄 획은 화면에 보이는 모양(지금 열 레이아웃으로 환산한 것)을 기준으로 지우고, 조각은 그 레이아웃(lay)을 이어받는다.
      const shown = stroke.lay && stroke.anchor !== undefined ? remapStroke(stroke, active.layouts.get(stroke.anchor)) : stroke;
      const box = stroke.anchor !== undefined ? active.boxes.get(stroke.anchor) ?? null : undefined;
      const points = resolvePoints(shown, active.layer, box);
      if (!points) {
        next.push(stroke);
        continue;
      }
      const result = eraseStroke(points, center, radius);
      if (!result.changed) {
        next.push(stroke);
        continue;
      }
      changed = true;
      if (isProductAnchor(stroke.anchor)) active.touched.add(stroke.anchor);
      for (const piece of result.pieces) {
        const base = { id: newId(), color: stroke.color, width: stroke.width };
        next.push(toPieceStroke(base, piece, shown, box, active.layer));
      }
    }
    if (changed) {
      stateRef.current = { ...stateRef.current, strokes: next };
      scheduleRedraw();
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = toolRef.current;
    const canvas = canvasRef.current;
    if (!current || !canvas) return;
    if (e.width > PALM_PX || e.height > PALM_PX) return; // 손바닥: 무시한다(먼저 닿아 있어도 뒤에 닿는 작은 접촉은 그린다)
    const two = twoFingerRef.current;
    if (two) {
      if (e.timeStamp - two.startedAt <= TWO_FINGER.staleMs) {
        two.broken = true; // 판정 중에 세 번째 접촉이 닿으면 되돌리기가 아니다
        return;
      }
      twoFingerRef.current = null; // 오래 남은 상태(손가락 뗌 이벤트를 놓쳤다)는 버리고 새로 시작한다
    }
    const first = activeRef.current;
    if (first) {
      // 첫 손가락이 아직 쓰기 시작하지 않았을 때(안 움직였을 때) 곧바로 다른 손가락이 닿으면 두 손가락 탭 판정을 시작한다. 첫 손가락이 이미 그린 점은 버린다.
      if (current === 'pen' && first.pointerId !== e.pointerId) {
        const second = local(e);
        const firstPoint = first.points[0];
        if (startsTwoFingerTap({ pointerType: first.pointerType, startedAt: first.startedAt, pathPx: pathLength(first.points), point: firstPoint }, { pointerType: e.pointerType, timeStamp: e.timeStamp, point: second })) {
          activeRef.current = null;
          scheduleRedraw(); // 첫 손가락이 찍은 점을 지운다
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            // 이미 사라진 접촉은 캡처할 수 없다. 그래도 판정한다.
          }
          twoFingerRef.current = {
            startedAt: first.startedAt,
            start: new Map([[first.pointerId, firstPoint], [e.pointerId, second]]),
            down: new Set([first.pointerId, e.pointerId]),
            broken: false,
            at: { x: (firstPoint.x + second.x) / 2, y: (firstPoint.y + second.y) / 2 },
          };
        }
      }
      return; // 한 획이 진행 중일 때 들어오는 다른 접촉은 무시한다
    }
    closeCard(); // 그리기 시작하면 열려 있던 설정 카드를 닫는다
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 이미 사라진 접촉(유령 터치)은 캡처할 수 없다. 그래도 그린다.
    }
    const p = local(e);
    const layerRect = canvas.getBoundingClientRect();
    const active: ActiveStroke = {
      pointerId: e.pointerId,
      tool: current,
      points: [p],
      cursor: startInk(p),
      tail: null,
      before: stateRef.current.strokes,
      boxes: current === 'eraser' ? anchorBoxes(canvas) : new Map<string, Box>(),
      layouts: current === 'eraser' ? measureStrokeLayouts(canvas, stateRef.current.strokes) : new Map<string, RowLayout>(),
      origin: { x: layerRect.left, y: layerRect.top },
      layer: { width: layerRect.width, height: layerRect.height },
      touched: new Set<string>(),
      startedAt: e.timeStamp,
      pointerType: e.pointerType,
    };
    activeRef.current = active;
    if (current === 'pen') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = prefsRef.current.color;
        ctx.fillStyle = prefsRef.current.color;
        ctx.lineWidth = prefsRef.current.penWidth;
      }
    } else {
      applyErase(p, active);
      movePreview(p);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const two = twoFingerRef.current;
    const twoStart = two?.start.get(e.pointerId);
    if (two && twoStart) {
      const now = local(e);
      if (Math.hypot(now.x - twoStart.x, now.y - twoStart.y) > TWO_FINGER.maxMovePx) two.broken = true; // 움직였으면 되돌리기가 아니다(그리지도 않는다)
      return;
    }
    const active = activeRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (events.length > 0 ? events : [e.nativeEvent]).map((ev) => ({ x: ev.clientX - active.origin.x, y: ev.clientY - active.origin.y }));
    if (active.tool === 'pen') {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      // 저장본과 같은 점 목록으로 그리려고 앞 점에서 STORE_MIN_STEP 이상 떨어진 점만 쓰고, 마지막 점은 획이 끝날 때 붙인다.
      // 그래서 쓰는 동안 보이는 모양이 획을 마친 뒤 저장본으로 다시 그린 모양과 같다.
      for (const p of points) {
        const last = active.points[active.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= STORE_MIN_STEP) {
          extendInk(ctx, active.cursor, p);
          active.points.push(p);
          active.tail = null;
        } else {
          active.tail = p;
        }
      }
    } else {
      for (const p of points) applyErase(p, active);
      movePreview(points[points.length - 1]);
    }
  };

  // 펜 획이 끝나면 동그라미·직선인지 판정한다. 맞으면 그 상품을 포장 완료로 올리고 획을 그 칸에 붙인다.
  const finishPenStroke = (active: ActiveStroke) => {
    const canvas = canvasRef.current;
    const boxes = canvas ? anchorBoxes(canvas) : active.boxes; // 상품 칸·줄 위치는 펜을 뗀 지금 한 번만 잰다
    const targets = chipTargets(boxes);
    const result = classifyStroke(active.points, targets);
    const base = { id: newId(), color: prefsRef.current.color, width: prefsRef.current.penWidth };
    const free = toFreeStroke(base, active.points, active.layer);
    const end = active.points[active.points.length - 1];
    let stroke = free;
    let packedItemId: string | undefined;
    if (result.kind === 'none') {
      if (dry) showNote(`인식 안 됨: ${REASON_LABEL[result.reason]}`, end);
    } else {
      const what = result.kind === 'circle' ? '동그라미' : '직선';
      const item = itemsRef.current.find((i) => i.id === result.itemId);
      const box = boxes.get(result.itemId);
      if (!item || !box) {
        if (dry) showNote(`${what}: 상품 정보를 찾지 못함`, end);
      } else if (item.cancelled) {
        if (dry) showNote(`${what} → ${item.label}: 취소된 상품이라 무시`, end);
      } else if (item.isPacked) {
        if (dry) showNote(`${what} → ${item.label}: 이미 포장 완료라 무시`, end);
      } else {
        stroke = toAnchoredStroke(base, active.points, item.id, box);
        if (dry) {
          showNote(`${what} → ${item.label} (${Math.round(result.coverage * 100)}%) · 시험 모드: 포장 상태는 바꾸지 않음`, end);
        } else {
          packedItemId = item.id;
          onPack(item.id);
        }
      }
    }
    // 상품 칸에 붙지 않은 획은 패널 칩(모니터 2의 품목별 수량)에 쓴 것이면 그 칩에 붙인다: 수량이 바뀌어 칩이 움직이거나 늘어나도 필기가 칩을 따라간다. 칩 사이 빈 곳은 낙서로 둔다.
    if (stroke.anchor === undefined) {
      const sumKey = pickSumAnchor(active.points, boxes);
      const sumBox = sumKey ? boxes.get(sumKey) : undefined;
      if (sumKey && sumBox) stroke = toAnchoredStroke(base, active.points, sumKey, sumBox);
    }
    // 그래도 붙지 않은 획은 시작한 줄에 붙인다: 줄 높이가 바뀌거나 줄이 움직여도 필기가 그 줄을 따라간다. 줄 밖이면 그림 층 비율 그대로다.
    if (stroke.anchor === undefined) {
      const rowKey = pickRowAnchor(active.points, boxes);
      const rowBox = rowKey ? boxes.get(rowKey) : undefined;
      // 줄 획에는 쓸 때의 열 레이아웃(lay)을 함께 저장한다: 폭이 다른 화면에서도 같은 칸 안에 그리려고. 잴 수 없으면 lay 없이 예전과 똑같이 저장한다.
      if (rowKey && rowBox) stroke = toAnchoredStroke(base, active.points, rowKey, rowBox, canvas ? measureRowLayouts(canvas, new Set([rowKey])).get(rowKey) : undefined);
    }
    const cur = stateRef.current;
    skipRedraw.current = true; // 방금 쓴 획은 이미 화면에 똑같이 그려져 있다 — 전체를 다시 그리지 않는다(획이 쌓일수록 느려지는 것을 막는다)
    commit({ strokes: [...cur.strokes, stroke], history: pushHistory(cur.history, { before: active.before, packed: packedItemId ? [packedItemId] : undefined }) });
  };

  // 두 손가락 탭 판정 상태(없으면 null). 판정 중에는 손가락이 획을 그리지 않는다.
  const twoFingerRef = useRef<{ startedAt: number; start: Map<number, Pt>; down: Set<number>; broken: boolean; at: Pt } | null>(null);

  // 손가락을 뗄 때: 두 손가락 탭 판정 중이면 그쪽에서 처리하고, 아니면 한 획의 끝으로 본다.
  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const two = twoFingerRef.current;
    if (two && two.down.has(e.pointerId)) {
      two.down.delete(e.pointerId);
      if (cancelled || e.timeStamp - two.startedAt > TWO_FINGER.maxMs) two.broken = true;
      if (two.down.size === 0) {
        twoFingerRef.current = null;
        if (!two.broken && stateRef.current.history.length > 0) {
          undo();
          showNote('되돌렸습니다', two.at);
        }
      }
      return;
    }
    finishStroke(e, cancelled);
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    activeRef.current = null;
    movePreview(null);
    if (active.tool === 'pen') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        if (active.tail) {
          extendInk(ctx, active.cursor, active.tail);
          active.points.push(active.tail);
        }
        endInk(ctx, active.cursor);
      }
      if (cancelled || active.points.length < 2) {
        scheduleRedraw();
        return;
      }
      finishPenStroke(active);
    } else if (stateRef.current.strokes !== active.before) {
      const cur = stateRef.current;
      // 지우개가 닿은 동그라미·직선이 붙어 있던 상품은 포장 완료를 원복한다(바로 전에 한 것이 아니라 예전에 한 것도 마찬가지, 2026-11-14 현장 요청).
      // 시험 모드에서는 바꾸지 않고 해제 대상만 알려 준다.
      const unpacked: string[] = [];
      const wouldUnpack: string[] = [];
      for (const id of active.touched) {
        const item = itemsRef.current.find((i) => i.id === id);
        if (!item) continue;
        if (dry) {
          wouldUnpack.push(item.label);
        } else if (item.isPacked && !item.cancelled) {
          unpacked.push(id);
          onUnpack(id);
        }
      }
      if (dry && wouldUnpack.length > 0) showNote(`지우개 → 포장 해제 대상: ${wouldUnpack.join(', ')} · 시험 모드: 포장 상태는 바꾸지 않음`, local(e));
      commit({ strokes: cur.strokes, history: pushHistory(cur.history, { before: active.before, unpacked: unpacked.length > 0 ? unpacked : undefined }) });
    }
  };

  // ── 메뉴 ──────────────────────────────────────────────────────────────────
  const undo = () => {
    const { entry, rest } = popHistory(stateRef.current.history);
    if (!entry) return;
    commit({ strokes: entry.before, history: rest });
    if (dry) return;
    // 그 작업이 포장 완료로 올렸던 상품은 해제하고, 지우개가 포장 해제했던 상품은 다시 포장 완료로 올린다.
    // 그 사이 다른 곳에서 이미 바뀌었으면 건드리지 않는다.
    for (const id of entry.packed ?? []) {
      const item = itemsRef.current.find((i) => i.id === id);
      if (item?.isPacked) onUnpack(id);
    }
    for (const id of entry.unpacked ?? []) {
      const item = itemsRef.current.find((i) => i.id === id);
      if (item && !item.isPacked && !item.cancelled) onPack(id);
    }
  };

  const clearAll = () => {
    const cur = stateRef.current;
    if (cur.strokes.length === 0) return;
    commit({ strokes: [], history: pushHistory(cur.history, { before: cur.strokes }) }); // 포장 상태는 그대로 두고 그림만 지운다
  };

  // 설정 카드: 펜·지우개를 길게 누르면 열린다(그 도구도 함께 켠다). 그 카드가 이미 열려 있으면 닫는다.
  const openSettings = (which: Tool) => {
    if (tool === which && card === which) {
      setCard(null);
      return;
    }
    setTool(which);
    setCard(which);
  };
  const { bind: bindLongPress, consumeClick } = useLongPress((key) => openSettings(key as Tool));

  // 펜 버튼: 짧게 누르면 펜 켜기/끄기(켜면 이전에 정한 색·굵기를 그대로 쓴다). 지우개를 쓰는 중이면 끄지 않고 펜으로 돌아간다. 펜을 끄려면 펜 상태에서 한 번 더 누른다.
  const tapPen = () => {
    setCard(null);
    setTool((t) => (t === 'pen' ? null : 'pen'));
  };
  // 지우개 버튼: 짧게 누르면 지우개, 지우개를 쓰는 중에 다시 누르면 펜으로 돌아간다(펜을 다시 켜는 한 번을 아낀다, 2026-11-14).
  const tapEraser = () => {
    setCard(null);
    setTool((t) => (t === 'eraser' ? 'pen' : 'eraser'));
  };

  // 손잡이를 끌면 묶음 전체가 움직이고, 놓으면 위치를 이 기기에 저장한다.
  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 캡처하지 못해도 끌기는 동작한다
    }
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
  };
  const dragTarget = (d: NonNullable<typeof dragRef.current>, e: React.PointerEvent<HTMLDivElement>): Pt => clampBar({ x: d.originX + e.clientX - d.startX, y: d.originY + e.clientY - d.startY }, BAR_SIZE, viewport);
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setPos(dragTarget(d, e));
  };
  const handleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const finalPos = dragTarget(d, e);
    setPos(finalPos);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ fx: finalPos.x / viewport.width, fy: finalPos.y / viewport.height }));
    } catch {
      // 저장이 막혀 있으면 이 화면에서만 바뀐다
    }
  };

  // 도구 버튼은 묶음 안에서 위에서 아래로 펜·지우개·되돌리기 순서다. 설정 카드는 길게 눌린 버튼 옆에 둔다.
  const bar = barLayout(pos, BAR_BUTTONS, BAR);
  const cardPos = card ? cardPosition(pos, bar.buttons[card === 'pen' ? 0 : 1].y, { width: CARD_W, height: card === 'pen' ? 216 : 236 }, BAR.button, viewport) : { x: 0, y: 0 };
  const canUndo = state.history.length > 0;
  const toolButton = (active: boolean) => `flex h-[40px] w-[40px] select-none items-center justify-center rounded-full border-2 shadow-lg transition-colors ${active ? 'border-[#003057] bg-[#003057] text-white' : 'border-[#003057] bg-white text-[#003057]'}`;

  // PC: 그림만 보여 준다. 캔버스는 입력을 받지 않아 아래의 표가 그대로 눌린다.
  if (viewOnly) return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full" aria-hidden="true" />;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 z-30 h-full w-full ${tool ? '' : 'pointer-events-none'}`}
        style={{ touchAction: tool ? 'none' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={previewRef} className="pointer-events-none absolute left-0 top-0 z-30 hidden rounded-full border-2 border-slate-500 bg-white/40" />
      {saveError && (
        <button type="button" onClick={() => void flushSave()} className="absolute left-1/2 top-2 z-30 max-w-md -translate-x-1/2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold leading-snug text-white shadow-lg" title="눌러서 다시 저장">
          그림이 저장되지 않았습니다 — 눌러서 다시 시도 ({saveError})
        </button>
      )}
      {dry && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white shadow">
          시험 모드 — 인식 결과만 보이고 포장 상태는 바뀌지 않으며 그림도 저장되지 않습니다
        </div>
      )}
      {note && (
        <div className="pointer-events-none absolute z-30 max-w-xs rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs font-bold leading-snug text-white shadow-lg" style={{ left: clamp(note.x, 8, Math.max(8, viewport.width - 360)), top: Math.max(8, note.y - 44) }}>
          {note.text}
        </div>
      )}

      {card && (
        <div className="fixed z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left: cardPos.x, top: cardPos.y, width: CARD_W }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">{card === 'pen' ? '펜 설정' : '지우개 설정'}</span>
            <button type="button" aria-label="설정 닫기" onClick={closeCard} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          {card === 'pen' ? (
            <>
              <div className="flex items-center justify-between gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    aria-label={c.name}
                    aria-pressed={prefs.color === c.hex}
                    title={c.name}
                    onClick={() => updatePrefs({ color: c.hex })}
                    className={`h-11 w-11 rounded-full border-4 ${prefs.color === c.hex ? 'border-slate-300 ring-2 ring-[#003057]' : 'border-white'}`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
              <SizeSlider label="굵기" value={prefs.penWidth} min={PEN_RANGE.min} max={PEN_RANGE.max} onChange={(v) => updatePrefs({ penWidth: v })} preview={<span className="block rounded-full" style={{ width: Math.max(prefs.penWidth, 2), height: Math.max(prefs.penWidth, 2), backgroundColor: prefs.color }} />} />
            </>
          ) : (
            <>
              <SizeSlider label="지우개 크기" value={prefs.eraserSize} min={ERASER_RANGE.min} max={ERASER_RANGE.max} onChange={(v) => updatePrefs({ eraserSize: v })} preview={<span className="block rounded-full border-2 border-slate-500 bg-white/60" style={{ width: Math.min(prefs.eraserSize * 2, 64), height: Math.min(prefs.eraserSize * 2, 64) }} />} />
              {/* 전체 지우기: 그림만 지우고 포장 상태는 유지한다. 되돌리기로 복구되므로 확인 창은 두지 않는다. */}
              <button type="button" onClick={clearAll} disabled={state.strokes.length === 0} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-300 bg-rose-50 text-sm font-bold text-rose-700 disabled:opacity-40">
                <Trash2 className="h-4 w-4" />
                전체 지우기
              </button>
              <p className="mt-1 text-center text-[11px] text-slate-500">되돌리기로 복구할 수 있습니다</p>
            </>
          )}
        </div>
      )}

      <div className="fixed z-40 flex select-none flex-col items-center" style={{ left: bar.left, top: bar.top, width: bar.width, gap: BAR.gap, touchAction: 'none' }}>
        <div
          title="끌어서 옮기기"
          aria-label="도구 묶음 옮기기"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onContextMenu={(e) => e.preventDefault()}
          className="flex w-full cursor-grab items-center justify-center rounded-full bg-slate-200/90 text-slate-500 shadow active:cursor-grabbing"
          style={{ height: BAR.handle, touchAction: 'none' }}
        >
          <GripHorizontal className="h-4 w-4" />
        </div>
        <button
          type="button"
          aria-label={tool === 'pen' ? '펜 끄기 (길게 누르면 펜 설정)' : '펜 켜기 (길게 누르면 펜 설정)'}
          aria-pressed={tool === 'pen'}
          title="누르면 펜 켜기/끄기 · 길게 누르면 색·굵기 설정"
          {...bindLongPress('pen')}
          onClick={() => {
            if (consumeClick()) return; // 길게 눌러 설정 카드를 열었으면 펜을 켜고 끄지 않는다
            tapPen();
          }}
          className={toolButton(tool === 'pen')}
          style={{ touchAction: 'none' }}
        >
          <PenLine className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={tool === 'eraser' ? '지우개 끄기 — 펜으로 돌아가기 (길게 누르면 지우개 설정)' : '지우개 켜기 (길게 누르면 지우개 설정)'}
          aria-pressed={tool === 'eraser'}
          title="누르면 지우개 · 다시 누르면 펜 · 길게 누르면 크기 설정과 전체 지우기"
          {...bindLongPress('eraser')}
          onClick={() => {
            if (consumeClick()) return;
            tapEraser();
          }}
          className={toolButton(tool === 'eraser')}
          style={{ touchAction: 'none' }}
        >
          <Eraser className="h-5 w-5" />
        </button>
        <button type="button" aria-label="되돌리기" title="되돌리기" disabled={!canUndo} onClick={undo} className={`${toolButton(false)} disabled:opacity-40`} style={{ touchAction: 'none' }}>
          <Undo2 className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}

// 드래그로 값을 조절하는 슬라이더 + 현재 크기를 보여 주는 미리보기.
function SizeSlider({ label, value, min, max, onChange, preview }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; preview: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
        <span>{label}</span>
        <span>{value}px</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-3 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 [&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:w-9 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#003057] [&::-webkit-slider-thumb]:shadow-lg"
          style={{ touchAction: 'none' }}
        />
        <div className="flex h-[68px] w-[68px] flex-shrink-0 items-center justify-center rounded-lg bg-slate-50">{preview}</div>
      </div>
    </div>
  );
}
