'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, Palette, PenLine, Undo2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchBoardInk, subscribeBoardInk } from '@/lib/ink/board-ink-client';
import { clearCanvas, drawPath, endInk, extendInk, fitCanvas, redrawLive, startInk, type LiveInk, type Pt } from '@/lib/ink/canvas';
import { eraseStroke } from '@/lib/ink/erase';
import { classifyStroke, REASON_LABEL } from '@/lib/ink/gesture';
import { popHistory, pushHistory, type HistoryEntry } from '@/lib/ink/history';
import { cardPosition, clampToViewport, stackPositions } from '@/lib/ink/menu-layout';
import { resolvePoints, STORE_MIN_STEP, toAnchoredStroke, toFreeStroke, type Box, type InkStroke } from '@/lib/ink/store';
import { saveBoardInk } from './actions';

// 칠판 펜 기능의 그림 층: 주문표 위에 얹는 캔버스 + 플로팅 버튼 + 세로로 쌓이는 메뉴.
// 확정 설계는 docs/decisions/2026-11-14-board-pen-feature.md. 요약:
// - 플로팅 버튼을 짧게 누르면 펜 켜기/끄기, 길게 누르면 메뉴(펜 설정·지우개·되돌리기)가 버튼 위(또는 아래)로 세로로 쌓인다. 끌면 위치를 옮긴다.
//   색·굵기·지우개 크기는 한 번 정하면 계속 쓰므로, 설정 카드는 설정할 때만 뜨고 그리기 시작하면 닫힌다(2026-11-14 현장 요청).
// - 펜·손가락·지우개가 모두 touch로 들어오므로(진단 결과) 도구 선택으로 구분하고, 손바닥은 접촉 크기로 거른다.
// - 동그라미·직선은 해당 상품 칸을 포장 완료로 올리고(뒤에서 처리, 표시 없음), 그 획은 상품 칸에 붙는다. 시험 모드(&ink=dry)는 결과만 보여 준다.
// - 되돌리기는 포장 완료도 되돌린다. 지우개가 동그라미·직선을 지우면 그 상품의 포장 완료도 원복한다(예전에 한 것도 포함, 되돌리기로 복구하면 다시 포장 완료로 올린다).
//   전체 지우기는 그림만 지우고 포장 상태는 유지한다.

const PALM_PX = 24; // 진단: 손가락·펜 1×1px, 손바닥 52×62px
const FAB = 45; // 플로팅 버튼 지름(예전 56px의 80%, 2026-11-14 — 내용을 덜 가리게)
const STACK_PITCH = 53; // 세로 메뉴의 버튼 간격(버튼 45px + 여백 8px)
const EDGE_MARGIN = 36;
const LONG_PRESS_MS = 500; // 플로팅 버튼을 이 시간 누르고 있으면 메뉴
const HOLD_MS = 1000; // 지우개를 이 시간 누르고 있으면 전체 지우기
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
const POS_KEY = 'board-ink-pos';
const NOTE_MS = 6000;
const SAVE_DELAY_MS = 500; // 그린 뒤 이 시간 안의 변경은 한 번의 저장으로 묶는다

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
  origin: Pt; // 획을 시작할 때 잰 그림 층의 화면 위 왼쪽 위(획 도중 점마다 다시 재지 않는다)
  layer: { width: number; height: number };
  touched: Set<string>; // 지우개가 닿은(잘라 낸) 획에 붙어 있던 상품 id
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

function defaultPos(): Pt {
  return { x: window.innerWidth - 56, y: window.innerHeight - 150 };
}

function loadPos(): Pt {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { fx?: number; fy?: number } | null;
    if (typeof raw?.fx === 'number' && typeof raw.fy === 'number') return clampToViewport({ x: raw.fx * window.innerWidth, y: raw.fy * window.innerHeight }, { width: window.innerWidth, height: window.innerHeight }, FAB / 2);
  } catch {
    // 저장된 위치가 없거나 읽을 수 없으면 기본 위치
  }
  return defaultPos();
}

// 그림 층(캔버스) 기준으로 잰 화면 위 상품 칸들의 위치. 칸은 `data-chip="상품 id"`로 찾는다.
function chipBoxes(canvas: HTMLCanvasElement): Map<string, Box> {
  const layer = canvas.getBoundingClientRect();
  const out = new Map<string, Box>();
  canvas.parentElement?.querySelectorAll<HTMLElement>('[data-chip]').forEach((el) => {
    const id = el.dataset.chip;
    const r = el.getBoundingClientRect();
    if (id && r.width > 0 && r.height > 0) out.set(id, { left: r.left - layer.left, top: r.top - layer.top, width: r.width, height: r.height });
  });
  return out;
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
}

export function InkLayer({ date, monitor, dry, items, onPack, onUnpack, onActiveChange, viewOnly = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<InkState>(() => ({ strokes: [], history: [] }));
  const stateRef = useRef(state);
  const [tool, setTool] = useState<Tool | null>(null); // 그리는 중인 도구(없으면 터치가 그대로 통과한다)
  const [menuOpen, setMenuOpen] = useState(false); // 길게 눌러 연 메뉴(펜 설정·지우개·되돌리기)
  const [card, setCard] = useState<Tool | null>(null); // 설정 카드(펜: 색·굵기, 지우개: 크기). 그리기 시작하면 닫힌다.
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [pos, setPos] = useState<Pt>(loadPos);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [layoutTick, setLayoutTick] = useState(0);
  const [note, setNote] = useState<{ text: string; x: number; y: number } | null>(null);
  const [holding, setHolding] = useState(false);

  const toolRef = useRef<Tool | null>(null);
  const prefsRef = useRef(prefs);
  const itemsRef = useRef(items);
  const activeRef = useRef<ActiveStroke | null>(null);
  const idCounter = useRef(0);
  const redrawFrame = useRef(0);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdFired = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean; long: boolean } | null>(null);

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
    const load = async () => {
      const strokes = await fetchBoardInk(supabase, date, monitor);
      if (cancelled || strokes === null) return;
      if (!viewOnly && committedRef.current) return;
      const next = { strokes, history: [] as InkState['history'] };
      stateRef.current = next;
      setState(next);
    };
    void load();
    if (!viewOnly) return () => { cancelled = true; };
    const unsubscribe = subscribeBoardInk(supabase, date, () => void load());
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
    const { error } = await saveBoardInk(date, monitor, stateRef.current.strokes);
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
      if (dirtyRef.current) void saveBoardInk(date, monitor, stateRef.current.strokes);
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
    clearCanvas(ctx);
    const layer = canvas.getBoundingClientRect();
    const boxes = chipBoxes(canvas);
    for (const stroke of stateRef.current.strokes) {
      const points = resolvePoints(stroke, { width: layer.width, height: layer.height }, stroke.anchor !== undefined ? boxes.get(stroke.anchor) ?? null : undefined);
      if (!points || points.length < 2) continue; // 붙은 상품 칸이 지금 화면에 없으면 그리지 않고 보관만 한다
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
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
    return () => observer.disconnect();
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
  }, [state.strokes, itemsKey, layoutTick]);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(redrawFrame.current);
      clearTimeout(noteTimer.current);
      clearTimeout(holdTimer.current);
      clearTimeout(longTimer.current);
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

  const closeMenu = () => {
    setMenuOpen(false);
    setCard(null);
    setHolding(false);
    clearTimeout(holdTimer.current);
  };

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
      const box = stroke.anchor !== undefined ? active.boxes.get(stroke.anchor) ?? null : undefined;
      const points = resolvePoints(stroke, active.layer, box);
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
      if (stroke.anchor !== undefined) active.touched.add(stroke.anchor);
      for (const piece of result.pieces) {
        const base = { id: newId(), color: stroke.color, width: stroke.width };
        next.push(stroke.anchor !== undefined && box ? toAnchoredStroke(base, piece, stroke.anchor, box) : toFreeStroke(base, piece, active.layer));
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
    if (activeRef.current) return; // 한 획이 진행 중일 때 들어오는 다른 접촉은 무시한다
    closeMenu(); // 그리기 시작하면 열려 있던 메뉴·설정 카드를 닫는다
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
      boxes: current === 'eraser' ? chipBoxes(canvas) : new Map<string, Box>(),
      origin: { x: layerRect.left, y: layerRect.top },
      layer: { width: layerRect.width, height: layerRect.height },
      touched: new Set<string>(),
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
    const boxes = canvas ? chipBoxes(canvas) : active.boxes; // 상품 칸 위치는 펜을 뗀 지금 한 번만 잰다
    const targets = [...boxes].map(([id, box]) => ({ id, ...box }));
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
    const cur = stateRef.current;
    skipRedraw.current = true; // 방금 쓴 획은 이미 화면에 똑같이 그려져 있다 — 전체를 다시 그리지 않는다(획이 쌓일수록 느려지는 것을 막는다)
    commit({ strokes: [...cur.strokes, stroke], history: pushHistory(cur.history, { before: active.before, packed: packedItemId ? [packedItemId] : undefined }) });
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

  const openPenSettings = () => {
    if (tool === 'pen' && card === 'pen') {
      setCard(null); // 설정 카드가 열려 있을 때 다시 누르면 닫는다(펜은 켜 둔 채)
      return;
    }
    setTool('pen');
    setCard('pen');
  };

  const eraserDown = () => {
    holdFired.current = false;
    if (tool !== 'eraser') return;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdFired.current = true;
      setHolding(false);
      clearAll();
    }, HOLD_MS);
  };
  const eraserUp = () => {
    clearTimeout(holdTimer.current);
    setHolding(false);
    if (holdFired.current) {
      holdFired.current = false;
      return;
    }
    if (tool !== 'eraser') {
      setTool('eraser');
      setCard('eraser');
    } else {
      setTool('pen'); // 이미 지우개면 다시 눌러 취소 = 펜으로 복귀(펜을 다시 켜는 한 번을 아낀다, 2026-11-14)
      setCard(null);
    }
  };
  const eraserCancel = () => {
    clearTimeout(holdTimer.current);
    setHolding(false);
  };

  // 플로팅 버튼: 짧게 누르면 펜 켜기/끄기, 길게 누르면 메뉴, 끌면 위치 이동.
  const fabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 캡처하지 못해도 누르기·끌기는 동작한다
    }
    const drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, moved: false, long: false };
    dragRef.current = drag;
    clearTimeout(longTimer.current);
    longTimer.current = setTimeout(() => {
      if (dragRef.current === drag && !drag.moved) {
        drag.long = true;
        setMenuOpen((open) => !open);
        setCard(null);
      }
    }, LONG_PRESS_MS);
  };
  const fabMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 10) {
      d.moved = true;
      clearTimeout(longTimer.current);
    }
    if (d.moved) setPos(clampToViewport({ x: d.originX + dx, y: d.originY + dy }, viewport, FAB / 2));
  };
  const fabUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    clearTimeout(longTimer.current);
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (d.moved) {
      const finalPos = clampToViewport({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) }, viewport, FAB / 2);
      setPos(finalPos);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ fx: finalPos.x / viewport.width, fy: finalPos.y / viewport.height }));
      } catch {
        // 저장이 막혀 있으면 이 화면에서만 바뀐다
      }
      return;
    }
    if (d.long) return; // 길게 눌러 메뉴를 열었으면 펜을 켜고 끄지 않는다
    if (tool === 'eraser') {
      closeMenu();
      setTool('pen'); // 지우개를 쓰는 중에 플로팅 버튼을 누르면 펜으로 복귀한다(끄지 않는다). 펜을 끄려면 펜 상태에서 한 번 더 누른다.
      return;
    }
    if (menuOpen) {
      closeMenu(); // 메뉴가 열려 있을 때 짧게 누르면 메뉴만 닫는다
      return;
    }
    setTool((t) => (t ? null : 'pen')); // 짧게 누르면 펜 켜기/끄기(지우개 중이면 위에서 펜으로 복귀)(켜면 이전에 정한 색·굵기를 그대로 쓴다)
  };

  // 메뉴는 플로팅 버튼 위(화면 아래쪽에 있을 때) 또는 아래로 세로로 쌓고, 설정 카드는 눌린 버튼 옆에 둔다.
  const [penPos, eraserPos, undoPos] = stackPositions(pos, 3, STACK_PITCH, viewport, EDGE_MARGIN);
  const selectedPos = card === 'pen' ? penPos : card === 'eraser' ? eraserPos : null;
  const cardPos = selectedPos ? cardPosition(pos, selectedPos.y, { width: CARD_W, height: card === 'pen' ? 188 : 132 }, FAB, viewport) : { x: 0, y: 0 };
  const canUndo = state.history.length > 0;
  const menuButton = (active: boolean) => `fixed z-40 flex h-[45px] w-[45px] flex-col items-center justify-center gap-px rounded-full border-2 shadow-lg transition-colors ${active ? 'border-[#003057] bg-[#003057] text-white' : 'border-slate-300 bg-white text-slate-700'}`;
  const FabIcon = tool === 'eraser' ? Eraser : PenLine;

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
        onPointerUp={(e) => finishStroke(e, false)}
        onPointerCancel={(e) => finishStroke(e, true)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* 펜이 꺼져 있을 때 메뉴가 열려 있으면, 화면의 다른 곳을 누르는 것으로 메뉴를 닫는다. 펜이 켜져 있으면 그리기 시작이 메뉴를 닫는다. */}
      {menuOpen && !tool && <div className="fixed inset-0 z-30" onPointerDown={closeMenu} />}
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

      {menuOpen && penPos && eraserPos && undoPos && (
        <>
          <button type="button" aria-label="펜 설정(색·굵기)" aria-pressed={card === 'pen'} title="펜 설정 — 색과 굵기" onClick={openPenSettings} className={menuButton(card === 'pen')} style={{ left: penPos.x - FAB / 2, top: penPos.y - FAB / 2 }}>
            <Palette className="h-4 w-4" />
            <span className="text-[9px] font-bold leading-none">펜 설정</span>
          </button>
          <button
            type="button"
            aria-label="지우개 (선택한 뒤 1초 누르고 있으면 전체 지우기)"
            aria-pressed={tool === 'eraser'}
            title="지우개 — 선택한 뒤 1초 누르고 있으면 전체 지우기"
            onPointerDown={eraserDown}
            onPointerUp={eraserUp}
            onPointerCancel={eraserCancel}
            onPointerLeave={eraserCancel}
            onContextMenu={(e) => e.preventDefault()}
            className={menuButton(tool === 'eraser')}
            style={{ left: eraserPos.x - FAB / 2, top: eraserPos.y - FAB / 2, touchAction: 'none' }}
          >
            <Eraser className="h-4 w-4" />
            <span className="text-[9px] font-bold leading-none">지우개</span>
            <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
              <circle cx="28" cy="28" r="25" fill="none" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" strokeDasharray="157" style={{ strokeDashoffset: holding ? 0 : 157, transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : 'none' }} />
            </svg>
          </button>
          <button type="button" aria-label="되돌리기" title="되돌리기" disabled={!canUndo} onClick={undo} className={`${menuButton(false)} disabled:opacity-40`} style={{ left: undoPos.x - FAB / 2, top: undoPos.y - FAB / 2 }}>
            <Undo2 className="h-4 w-4" />
            <span className="text-[9px] font-bold leading-none">되돌리기</span>
          </button>
        </>
      )}

      {menuOpen && card && (
        <div className="fixed z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left: cardPos.x, top: cardPos.y, width: CARD_W }}>
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
            <SizeSlider label="지우개 크기" value={prefs.eraserSize} min={ERASER_RANGE.min} max={ERASER_RANGE.max} onChange={(v) => updatePrefs({ eraserSize: v })} preview={<span className="block rounded-full border-2 border-slate-500 bg-white/60" style={{ width: Math.min(prefs.eraserSize * 2, 64), height: Math.min(prefs.eraserSize * 2, 64) }} />} />
          )}
        </div>
      )}

      <button
        type="button"
        aria-label={tool ? '펜 끄기 (길게 누르면 메뉴)' : '펜 켜기 (길게 누르면 메뉴)'}
        aria-pressed={tool !== null}
        title="누르면 펜 켜기/끄기 · 길게 누르면 펜 설정·지우개·되돌리기 · 끌면 위치 이동"
        onPointerDown={fabDown}
        onPointerMove={fabMove}
        onPointerUp={fabUp}
        onPointerCancel={() => {
          clearTimeout(longTimer.current);
          dragRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={`fixed z-40 flex h-[45px] w-[45px] items-center justify-center rounded-full border-2 shadow-xl ${tool ? 'border-[#003057] bg-[#003057] text-white' : 'border-[#003057] bg-white text-[#003057]'} ${menuOpen ? 'ring-4 ring-sky-300' : ''}`}
        style={{ left: pos.x - FAB / 2, top: pos.y - FAB / 2, touchAction: 'none' }}
      >
        <FabIcon className="h-[22px] w-[22px]" />
      </button>
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
