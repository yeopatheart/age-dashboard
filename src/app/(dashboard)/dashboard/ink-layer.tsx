'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, PenLine, Undo2 } from 'lucide-react';
import { clearCanvas, endInk, extendInk, fitCanvas, startInk, type InkCursor, type Pt } from '@/lib/ink/canvas';
import { eraseStroke } from '@/lib/ink/erase';
import { classifyStroke, REASON_LABEL } from '@/lib/ink/gesture';
import { popHistory, pushHistory, type HistoryEntry } from '@/lib/ink/history';
import { clampToViewport, radialPositions } from '@/lib/ink/radial';
import { inkKey, parseInk, pruneInk, resolvePoints, serializeInk, toAnchoredStroke, toFreeStroke, type Box, type InkStroke } from '@/lib/ink/store';

// 칠판 펜 기능의 그림 층: 주문표 위에 얹는 캔버스 + 플로팅 버튼 + 사방으로 펼치는 도구함.
// 확정 설계는 docs/decisions/2026-11-14-board-pen-feature.md. 요약:
// - 도구(펜·지우개)를 고른 동안만 그려지고, 도구함을 접으면 터치가 그대로 통과한다. 상단 "칠판" 버튼이 켜져 있을 때만 이 컴포넌트가 그려진다.
// - 펜·손가락·지우개가 모두 touch로 들어오므로(진단 결과) 도구 선택으로 구분하고, 손바닥은 접촉 크기로 거른다.
// - 동그라미·대각선은 해당 상품 칸을 포장 완료로 올리고(뒤에서 처리, 표시 없음), 그 획은 상품 칸에 붙는다. 시험 모드(&ink=dry)는 결과만 보여 준다.
// - 되돌리기는 포장 완료도 되돌리고, 지우개·전체 지우기는 그림만 지운다.

const PALM_PX = 24; // 진단: 손가락·펜 1×1px, 손바닥 52×62px
const FAB = 56;
const RING_RADIUS = 92;
const EDGE_MARGIN = 36;
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

type Tool = 'pen' | 'eraser';
interface Prefs {
  color: string;
  penWidth: number;
  eraserSize: number;
}
const DEFAULT_PREFS: Prefs = { color: COLORS[0].hex, penWidth: 4, eraserSize: 40 };

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
  cursor: InkCursor;
  before: InkStroke[];
  boxes: Map<string, Box>;
  layer: { width: number; height: number };
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

function loadStrokes(date: string, monitor: string): InkStroke[] {
  try {
    return parseInk(localStorage.getItem(inkKey(date, monitor)));
  } catch {
    return [];
  }
}

function saveStrokes(date: string, monitor: string, strokes: InkStroke[]) {
  try {
    localStorage.setItem(inkKey(date, monitor), serializeInk(strokes));
  } catch {
    // 저장이 막혀 있으면(시크릿 모드, 용량 초과) 이 화면에서만 유지된다
  }
}

// 이 날짜 앞뒤 이틀 밖의 오래된 그림은 지운다.
function pruneOldInk(date: string) {
  try {
    const base = new Date(`${date}T00:00:00Z`);
    const keep = [-2, -1, 0, 1, 2].map((d) => new Date(base.getTime() + d * 86_400_000).toISOString().slice(0, 10));
    pruneInk(localStorage, keep);
  } catch {
    // 무시
  }
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

function drawPolyline(ctx: CanvasRenderingContext2D, points: Pt[]) {
  let cursor = startInk(points[0]);
  for (let i = 1; i < points.length; i++) cursor = extendInk(ctx, cursor, points[i]);
  endInk(ctx, cursor);
}

interface Props {
  date: string;
  monitor: string;
  dry: boolean;
  items: InkItem[];
  onPack: (itemId: string) => void;
  onUnpack: (itemId: string) => void;
}

export function InkLayer({ date, monitor, dry, items, onPack, onUnpack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<InkState>(() => ({ strokes: loadStrokes(date, monitor), history: [] }));
  const stateRef = useRef(state);
  const [tool, setTool] = useState<Tool | null>(null);
  const [expanded, setExpanded] = useState(false);
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
  const holdFired = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  useEffect(() => {
    toolRef.current = tool;
    prefsRef.current = prefs;
    itemsRef.current = items;
  });

  // 같은 날짜 앞뒤 이틀 밖의 오래된 그림을 한 번 지운다.
  useEffect(() => {
    pruneOldInk(date);
  }, [date]);

  const newId = () => `${Date.now().toString(36)}${(idCounter.current++).toString(36)}`;

  const commit = (next: InkState) => {
    stateRef.current = next;
    setState(next);
    saveStrokes(date, monitor, next.strokes);
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
      drawPolyline(ctx, points);
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
  useLayoutEffect(() => {
    redraw();
  }, [state.strokes, items, layoutTick]);

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
      before: stateRef.current.strokes,
      boxes: chipBoxes(canvas),
      layer: { width: layerRect.width, height: layerRect.height },
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
    const points = (events.length > 0 ? events : [e.nativeEvent]).map(local);
    if (active.tool === 'pen') {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      for (const p of points) {
        active.cursor = extendInk(ctx, active.cursor, p);
        active.points.push(p);
      }
    } else {
      for (const p of points) applyErase(p, active);
      movePreview(points[points.length - 1]);
    }
  };

  // 펜 획이 끝나면 동그라미·대각선인지 판정한다. 맞으면 그 상품을 포장 완료로 올리고 획을 그 칸에 붙인다.
  const finishPenStroke = (active: ActiveStroke) => {
    const targets = [...active.boxes].map(([id, box]) => ({ id, ...box }));
    const result = classifyStroke(active.points, targets);
    const base = { id: newId(), color: prefsRef.current.color, width: prefsRef.current.penWidth };
    const free = toFreeStroke(base, active.points, active.layer);
    const end = active.points[active.points.length - 1];
    let stroke = free;
    let packedItemId: string | undefined;
    if (result.kind === 'none') {
      if (dry) showNote(`인식 안 됨: ${REASON_LABEL[result.reason]}`, end);
    } else {
      const what = result.kind === 'circle' ? '동그라미' : '대각선';
      const item = itemsRef.current.find((i) => i.id === result.itemId);
      const box = active.boxes.get(result.itemId);
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
    commit({ strokes: [...cur.strokes, stroke], history: pushHistory(cur.history, { before: active.before, packedItemId }) });
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    activeRef.current = null;
    movePreview(null);
    if (active.tool === 'pen') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) endInk(ctx, active.cursor);
      if (cancelled || active.points.length < 2) {
        scheduleRedraw();
        return;
      }
      finishPenStroke(active);
    } else if (stateRef.current.strokes !== active.before) {
      const cur = stateRef.current;
      commit({ strokes: cur.strokes, history: pushHistory(cur.history, { before: active.before }) });
    }
  };

  // ── 도구함 ────────────────────────────────────────────────────────────────
  const undo = () => {
    const { entry, rest } = popHistory(stateRef.current.history);
    if (!entry) return;
    commit({ strokes: entry.before, history: rest });
    if (entry.packedItemId && !dry) {
      const item = itemsRef.current.find((i) => i.id === entry.packedItemId);
      if (item?.isPacked) onUnpack(item.id); // 이미 다른 곳에서 해제됐으면 건드리지 않는다
    }
  };

  const clearAll = () => {
    const cur = stateRef.current;
    if (cur.strokes.length === 0) return;
    commit({ strokes: [], history: pushHistory(cur.history, { before: cur.strokes }) }); // 포장 상태는 그대로 두고 그림만 지운다
  };

  const collapse = () => {
    setExpanded(false);
    setTool(null);
    setHolding(false);
    clearTimeout(holdTimer.current);
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
    setTool((t) => (t === 'eraser' ? null : 'eraser'));
  };
  const eraserCancel = () => {
    clearTimeout(holdTimer.current);
    setHolding(false);
  };

  const fabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 캡처하지 못해도 누르기·끌기는 동작한다
    }
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, moved: false };
  };
  const fabMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 10) d.moved = true;
    if (d.moved) setPos(clampToViewport({ x: d.originX + dx, y: d.originY + dy }, viewport, FAB / 2));
  };
  const fabUp = (e: React.PointerEvent<HTMLButtonElement>) => {
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
    if (expanded) collapse();
    else setExpanded(true);
  };

  const ring = radialPositions(pos, 3, RING_RADIUS, viewport, EDGE_MARGIN);
  const [penPos, eraserPos, undoPos] = ring;
  const selectedPos = tool === 'pen' ? penPos : tool === 'eraser' ? eraserPos : null;
  const cardHeight = tool === 'pen' ? 188 : 132;
  let cardLeft = 0;
  let cardTop = 0;
  if (selectedPos) {
    // 선택한 도구 버튼에서 바깥쪽(버튼 고리 너머)으로 카드를 놓는다.
    const dx = selectedPos.x - pos.x;
    const dy = selectedPos.y - pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const reach = RING_RADIUS + FAB / 2 + 14 + (Math.abs(dx / len) * CARD_W) / 2 + (Math.abs(dy / len) * cardHeight) / 2;
    cardLeft = clamp(pos.x + (dx / len) * reach - CARD_W / 2, 8, viewport.width - CARD_W - 8);
    cardTop = clamp(pos.y + (dy / len) * reach - cardHeight / 2, 8, viewport.height - cardHeight - 8);
  }
  const canUndo = state.history.length > 0;
  const toolButton = (active: boolean) => `fixed z-40 flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-lg transition-colors ${active ? 'border-[#003057] bg-[#003057] text-white' : 'border-slate-300 bg-white text-slate-700'}`;

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
      <div ref={previewRef} className="pointer-events-none absolute left-0 top-0 z-30 hidden rounded-full border-2 border-slate-500 bg-white/40" />
      {dry && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white shadow">
          시험 모드 — 인식 결과만 보이고 포장 상태는 바뀌지 않습니다
        </div>
      )}
      {note && (
        <div className="pointer-events-none absolute z-30 max-w-xs rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs font-bold leading-snug text-white shadow-lg" style={{ left: clamp(note.x, 8, Math.max(8, viewport.width - 360)), top: Math.max(8, note.y - 44) }}>
          {note.text}
        </div>
      )}

      {expanded && penPos && eraserPos && undoPos && (
        <>
          <button type="button" aria-label="펜" aria-pressed={tool === 'pen'} title="펜" onClick={() => setTool((t) => (t === 'pen' ? null : 'pen'))} className={toolButton(tool === 'pen')} style={{ left: penPos.x - FAB / 2, top: penPos.y - FAB / 2 }}>
            <PenLine className="h-6 w-6" />
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
            className={toolButton(tool === 'eraser')}
            style={{ left: eraserPos.x - FAB / 2, top: eraserPos.y - FAB / 2, touchAction: 'none' }}
          >
            <Eraser className="h-6 w-6" />
            <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
              <circle cx="28" cy="28" r="25" fill="none" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" strokeDasharray="157" style={{ strokeDashoffset: holding ? 0 : 157, transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : 'none' }} />
            </svg>
          </button>
          <button type="button" aria-label="되돌리기" title="되돌리기" disabled={!canUndo} onClick={undo} className={`${toolButton(false)} disabled:opacity-40`} style={{ left: undoPos.x - FAB / 2, top: undoPos.y - FAB / 2 }}>
            <Undo2 className="h-6 w-6" />
          </button>
        </>
      )}

      {expanded && tool && (
        <div className="fixed z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left: cardLeft, top: cardTop, width: CARD_W }}>
          {tool === 'pen' ? (
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
        aria-label={expanded ? '펜 도구함 접기' : '펜 도구함 펼치기'}
        aria-expanded={expanded}
        title="펜 — 누르면 도구함이 펼쳐지고, 끌면 위치를 옮깁니다"
        onPointerDown={fabDown}
        onPointerMove={fabMove}
        onPointerUp={fabUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={`fixed z-40 flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-xl ${expanded ? 'border-[#003057] bg-[#003057] text-white' : 'border-[#003057] bg-white text-[#003057]'}`}
        style={{ left: pos.x - FAB / 2, top: pos.y - FAB / 2, touchAction: 'none' }}
      >
        <PenLine className="h-7 w-7" />
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
