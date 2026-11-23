'use client';
import { useEffect, useRef } from 'react';
import { scopeAreas, type Rect } from '@/lib/sticker-ui';
import type { StickerScope } from '@/lib/stickers';

// 스티커 붙이기 모드에서 고른 스티커가 붙는 곳만 살리고 나머지 열을 연한 막으로 덮는다(결정: docs/decisions/2026-11-23-business-stickers.md).
// 고객사용이면 고객명 열, 상품 칸용이면 상품 칸 열이 테두리로 강조되고 나머지는 흐려진다. 열 단위라 위아래 스크롤에도 어긋나지 않는다.
// 칸 자체의 투명도·필터는 건드리지 않는다(칠판의 그리기 합성 경로를 바꾸면 까만 화면이 된 적이 있다, 2026-11-15): 화면 위에 따로 그린 상자일 뿐이다.
// 막은 pointer-events-none이라 탭을 막지 않는다(붙이기 판정은 sticker-layer가 위치로 한다). 상자 위치는 DOM에서 재서 직접 쓴다(상태 갱신 없음).

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
const isShown = (el: Element) => el.getClientRects().length > 0;

function place(el: HTMLElement | null, r: Rect | null | undefined) {
  if (!el) return;
  if (!r) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.right - r.left}px`;
  el.style.height = `${r.bottom - r.top}px`;
}

export function StickerScopeVeil({ scope }: { scope: StickerScope | null }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const veilARef = useRef<HTMLDivElement>(null);
  const veilBRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scope) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const body = document.querySelector<HTMLElement>('.stk-clip');
      const name = [...document.querySelectorAll<HTMLElement>('[data-name-cell]')].find(isShown);
      const box = name?.nextElementSibling;
      const row = name?.parentElement;
      const areas = body && name && box && row ? scopeAreas(scope, { body: rectOf(body), row: rectOf(row), name: rectOf(name), box: rectOf(box) }) : null;
      place(targetRef.current, areas?.target);
      place(veilARef.current, areas?.veils[0]);
      place(veilBRef.current, areas?.veils[1]);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true); // 가로 스크롤(전체 보기)도 열 위치가 바뀐다
    const body = document.querySelector<HTMLElement>('.stk-clip');
    const observer = typeof ResizeObserver !== 'undefined' && body ? new ResizeObserver(schedule) : null;
    if (observer && body) observer.observe(body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
    };
  }, [scope]);

  if (!scope) return null;
  const veil = 'pointer-events-none fixed z-30 hidden bg-white/60';
  return (
    <>
      <div ref={veilARef} className={veil} aria-hidden />
      <div ref={veilBRef} className={veil} aria-hidden />
      <div ref={targetRef} className="pointer-events-none fixed z-30 hidden rounded-sm bg-sky-400/10 ring-[3px] ring-inset ring-sky-500/90" aria-hidden />
    </>
  );
}
