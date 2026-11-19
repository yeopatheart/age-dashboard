'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

export interface TimeItem {
  key: number;
  time: string; // "10:32"
  href: string;
  selected: boolean;
  drop: boolean; // 이 시각에 급감 감지가 있었는지
}

// 시각 목록(왼쪽): 최신이 위. 고른 시각이 보이게 스크롤하고, ↑/↓ 키로 이웃 시각으로 옮긴다.
export function TimeList({ items, upHref, downHref }: { items: TimeItem[]; upHref: string | null; downHref: string | null }) {
  const router = useRouter();
  const selectedRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [items]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return; // 확대 창이 열려 있으면 이동하지 않는다
      const href = e.key === 'ArrowUp' ? upHref : e.key === 'ArrowDown' ? downHref : null;
      if (!href) return;
      e.preventDefault();
      router.push(href, { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [upHref, downHref, router]);

  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0" aria-label="시각 목록">
      {items.map((item) => (
        <li key={item.key} className="shrink-0 lg:shrink">
          <Link
            ref={item.selected ? selectedRef : undefined}
            href={item.href}
            scroll={false}
            aria-current={item.selected ? 'true' : undefined}
            className={`block min-w-[6.5rem] rounded-lg border px-2.5 py-1.5 transition-colors lg:min-w-0 ${item.selected ? 'border-slate-900 bg-slate-900 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold tabular-nums">{item.time}</span>
              {item.drop && <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${item.selected ? 'bg-rose-500 text-white' : 'bg-rose-100 text-rose-700'}`}>급감 감지</span>}
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
