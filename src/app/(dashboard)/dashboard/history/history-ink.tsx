'use client';
import { useEffect, useRef } from 'react';
import { clearCanvas, drawPath, fitCanvas, needsFit } from '@/lib/ink/canvas';
import { remapStroke, resolvePoints, rowLayoutFrom, type Box, type InkStroke, type RowLayout } from '@/lib/ink/store';

// 필기 이력 화면의 그림 층(읽기 전용). 주문 목록의 InkLayer를 쓰거나 바꾸지 않고, 같은 좌표 규칙(store.ts의 순수 함수)만 가져다 쓴다.
// 획은 시작한 줄(data-ink-row)·상품 칸(data-chip)에 붙어 저장돼 있어서, 그 요소의 지금 위치를 재서 그린다.
// 붙은 요소가 이 화면에 없으면(품목 패널 칩 등) 그리지 않는다. 낙서(붙은 요소 없음)는 이 층 크기에 대한 비율이라 위치가 정확하지 않을 수 있다.

function anchorBoxes(canvas: HTMLCanvasElement): Map<string, Box> {
  const layer = canvas.getBoundingClientRect();
  const out = new Map<string, Box>();
  const measure = (el: HTMLElement, key: string | undefined) => {
    if (!key) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.set(key, { left: r.left - layer.left, top: r.top - layer.top, width: r.width, height: r.height });
  };
  canvas.parentElement?.querySelectorAll<HTMLElement>('[data-chip]').forEach((el) => measure(el, el.dataset.chip));
  canvas.parentElement?.querySelectorAll<HTMLElement>('[data-ink-row]').forEach((el) => measure(el, el.dataset.inkRow ? `row:${el.dataset.inkRow}` : undefined));
  return out;
}

// 쓸 때의 열 레이아웃(lay)이 있는 줄 획은 지금 줄의 열 레이아웃으로 환산해서 같은 열 안에 그린다.
function rowLayouts(canvas: HTMLCanvasElement, strokes: readonly InkStroke[]): Map<string, RowLayout> {
  const keys = new Set<string>();
  for (const s of strokes) if (s.lay && s.anchor !== undefined) keys.add(s.anchor);
  const out = new Map<string, RowLayout>();
  if (keys.size === 0) return out;
  try {
    canvas.parentElement?.querySelectorAll<HTMLElement>('[data-ink-row]').forEach((el) => {
      const key = el.dataset.inkRow ? `row:${el.dataset.inkRow}` : undefined;
      if (!key || !keys.has(key)) return;
      const lay = rowLayoutFrom(getComputedStyle(el).gridTemplateColumns, el.offsetWidth);
      if (lay) out.set(key, lay);
    });
  } catch {
    // 측정에 실패한 줄은 환산 없이 그린다
  }
  return out;
}

// widthFactor: 저장된 굵기에 곱하는 값(1이면 칠판에서 쓴 굵기 그대로). 이력은 칩 글자를 읽는 것이 먼저라 기본은 가늘게 그린다. visible이 false면 필기를 그리지 않는다.
export function HistoryInk({ strokes, redrawKey, widthFactor = 1, visible = true }: { strokes: readonly InkStroke[]; redrawKey: string; widthFactor?: number; visible?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const layer = canvas.getBoundingClientRect();
      if (needsFit(canvas.width, canvas.height, layer.width, layer.height, window.devicePixelRatio || 1)) fitCanvas(canvas);
      clearCanvas(ctx);
      if (!visible) return;
      const boxes = strokes.some((s) => s.anchor !== undefined) ? anchorBoxes(canvas) : new Map<string, Box>();
      const layouts = rowLayouts(canvas, strokes);
      // 표를 창 폭에 맞춰 확대·축소하면(transform) 화면 좌표가 그 배율로 재어지므로 선 굵기도 같은 배율로 그린다(주문 목록 PC 보기와 같은 방식).
      const scale = canvas.offsetWidth > 0 ? layer.width / canvas.offsetWidth : 1;
      for (const raw of strokes) {
        const stroke = raw.lay && raw.anchor !== undefined ? remapStroke(raw, layouts.get(raw.anchor)) : raw;
        const points = resolvePoints(stroke, { width: layer.width, height: layer.height }, stroke.anchor !== undefined ? boxes.get(stroke.anchor) ?? null : undefined);
        if (!points || points.length < 2) continue;
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = Math.max(0.8, stroke.width * scale * widthFactor);
        ctx.globalAlpha = 0.85; // 겹친 칩 글자가 비쳐 보이게 한다
        drawPath(ctx, points);
      }
      ctx.globalAlpha = 1;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    window.addEventListener('resize', schedule);
    void document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [strokes, redrawKey, widthFactor, visible]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true" />;
}
