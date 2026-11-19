'use client';
import { Check, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cardNumberLabels } from '@/lib/card-number';
import { boardGridTemplate, businessIdsInBothRounds, cardIsCancelled, cardIsComplete, itemIsUndecided, productSlotCount, sepInnerWidth, type BoardGroup, type SnapshotMeta, type SummaryCard, type SummaryItem } from '@/lib/ink/history-view';
import type { InkStroke } from '@/lib/ink/store';
import { prepLabelOf } from '@/lib/orders';
import { terminalBadgeProps } from '@/lib/terminal-color';
import { HistoryInk } from './history-ink';
import { itemColors, SepHeader, SepRow } from './history-sep-rows';

// 스냅샷의 요약으로 칠판 모양의 표를 다시 그리고 그 위에 필기를 얹는다(읽기 전용). 주문 목록 코드를 복사·공유하지 않은 별도 표지만,
// 보이는 값은 칠판(dashboard-client.tsx)의 값을 따라 맞췄다: 린넨 색 테마(main-content-soft), 주문 70건 이하일 때의 줄 높이 18px,
// 상태별 칩 색(getItemStyle와 같은 클래스), 업체명 11px·터미널 9px. 열 순서(No · 터미널 · 고객명 · 박스 · 상품 1..N)도 같게 해서 필기가 같은 열에 놓인다.
// 칠판은 기준 화면(1248px 폭)을 창에 맞춰 확대하므로 이 표도 화면 폭에 맞춰 확대·축소한다(PC 보기와 같은 방식).
// 별도 주문 탭(group='sep')은 칠판의 별도 주문 팝업과 모양이 달라서(줄 44px 이상, 큰 칩) 그 모양의 표(history-sep-rows.tsx)로 그린다.

const STAGE_W = 1248;
const ROW_H = 18;
const NAME_FONT = 11;
const TERMINAL_FONT = 9;
// 칩 글자 크기 단계(수량 q · 품목명·단위 f · 괄호 표기 o · 줄 높이 배수). 칠판처럼 가장 큰 단계부터 시도해서 칩 안쪽 높이(줄 높이 − 3)에 들어가는 첫 단계를 쓴다.
// 한 줄에 들어가면 큰 글자로, 괄호 표기가 붙어 두 줄이 되면 두 줄이 들어가는 크기까지 줄어든다.
const PILL_STEPS: readonly (readonly [number, number, number, number])[] = [
  [10, 9, 8, 1.15],
  [9, 8, 7, 1.15],
  [8, 7, 7, 1.0],
  [7, 6, 7, 1.0],
];
const PILL_INNER = ROW_H - 3;

function Chip({ item }: { item: SummaryItem }) {
  const { bg, border, text } = itemColors(item.status, item.packed, item.unshipped, item.qty);
  const cancelled = item.status === 'cancelled';
  const parts: string[] = [];
  if (item.size) parts.push(item.size);
  const prep = prepLabelOf({ isMulbong: item.isMulbong, hasAerator: item.hasAerator });
  if (prep) parts.push(prep);
  const suffix = parts.length ? `(${parts.join(', ')})` : '';
  return (
    <div className="flex min-w-0 border-r border-slate-100 last:border-r-0">
      <div data-chip={item.id} className={`relative flex w-full items-center justify-start overflow-hidden rounded border px-1 shadow-sm ${bg} ${border}`}>
        {item.unshipped > 0 && !cancelled && (
          <span className="absolute left-0 top-0 z-20 rounded-br bg-amber-500 px-1 py-[2px] text-[9px] font-bold leading-none text-white" title={item.unshippedReason ? `미출고 사유: ${item.unshippedReason}` : '미출고'}>
            미출고 {item.unshipped}
          </span>
        )}
        {item.packed && !cancelled && <Check className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-slate-400/30" strokeWidth={4} />}
        <div data-pill className="z-10 flex w-full min-w-0 flex-wrap items-baseline justify-start gap-x-1 text-left break-keep select-none [overflow-wrap:anywhere]" style={{ fontSize: 'var(--pq, 10px)', lineHeight: 'var(--pl, 1.15)', maxHeight: PILL_INNER }}>
          <span className={`font-bold ${text}`} style={{ fontSize: 'var(--pn, 9px)' }}>
            {item.name}
          </span>
          {itemIsUndecided(item) ? (
            <span className="whitespace-nowrap rounded bg-amber-100 px-1 font-black text-amber-700" style={{ fontSize: 'var(--pn, 10px)' }}>
              수량 미정
            </span>
          ) : (
            <span className="whitespace-nowrap">
              <span className={`font-black ${text}`} style={{ fontSize: 'var(--pq, 11px)' }}>
                {item.qty}
              </span>
              <span className={`ml-0.5 font-semibold ${text}`} style={{ fontSize: 'var(--pn, 10px)' }}>
                {item.unit}
              </span>
            </span>
          )}
          {suffix && (
            <span className="font-semibold text-sky-600" style={{ fontSize: 'var(--po, 8px)' }}>
              {suffix}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// fixedScale이 있으면 그 배율(1 = 칠판 기준 화면 크기)로 고정하고, 없으면 바깥 상자 폭에 맞춰 maxScale까지 확대·축소한다(maxScale보다 넓으면 상자를 표 폭에 맞춘다).
export function HistoryBoard({ cards, meta, strokes, snapshotKey, group, sepCompact, fixedScale = null, maxScale = 2 }: { cards: SummaryCard[]; meta: SnapshotMeta; strokes: InkStroke[]; snapshotKey: string; group: BoardGroup; sepCompact: boolean; fixedScale?: number | null; maxScale?: number }) {
  const slots = productSlotCount(cards);
  const template = boardGridTemplate(slots);
  const labels = cardNumberLabels(cards.map((c) => ({ id: c.id, businessNumber: c.number, separate: c.separate })));
  const bothRounds = businessIdsInBothRounds(cards);
  const isSep = group === 'sep';
  const innerWidth = isSep ? sepInnerWidth(strokes, slots, sepCompact) : Math.max(STAGE_W, 44 + 76 + 150 + 64 + slots * 104);

  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [capped, setCapped] = useState(false); // 바깥 상자가 표를 maxScale로 키워도 남을 만큼 넓은지(그러면 상자를 표 폭에 맞춘다)
  const [innerHeight, setInnerHeight] = useState<number | null>(null);
  const scale = fixedScale ?? fitScale;
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const raw = outer.clientWidth / innerWidth;
      setFitScale(Math.min(maxScale, Math.max(0.4, raw)));
      setCapped(raw >= maxScale);
      setInnerHeight(inner.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [innerWidth, maxScale]);

  // 칩마다 글자 크기 단계를 골라 칩 안쪽 높이에 넣는다(칠판의 글자 맞춤과 같은 규칙). 배율(transform)은 scrollHeight에 영향이 없다.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    inner.querySelectorAll<HTMLElement>('[data-pill]').forEach((el) => {
      for (const [q, f, o, lh] of PILL_STEPS) {
        el.style.setProperty('--pq', `${q}px`);
        el.style.setProperty('--pn', `${f}px`);
        el.style.setProperty('--po', `${Math.min(o, f)}px`);
        el.style.setProperty('--pl', String(lh));
        if (el.scrollHeight <= PILL_INNER + 0.5) break;
      }
    });
  }, [cards, slots, innerWidth]);

  return (
    <div
      ref={outerRef}
      className="main-content-soft overflow-hidden rounded-xl border border-slate-300"
      style={{ height: innerHeight !== null ? Math.ceil(innerHeight * scale) + 1 : undefined, width: fixedScale ? Math.ceil(innerWidth * fixedScale) + 2 : capped ? Math.ceil(innerWidth * scale) + 2 : undefined, maxWidth: '100%' }}
    >
      <div ref={innerRef} data-board-capture className="relative bg-white" style={{ width: innerWidth, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {isSep ? (
          <>
            <SepHeader template={template} slots={slots} />
            {cards.map((card) => (
              <SepRow key={card.id} card={card} label={labels.get(card.id)} template={template} slots={slots} meta={meta} bothRounds={card.businessId !== null && bothRounds.has(card.businessId)} compact={sepCompact} />
            ))}
          </>
        ) : (
          <>
        <div className="soft-head-line grid text-[11px] leading-[14px] font-bold text-white" style={{ gridTemplateColumns: template, backgroundColor: 'var(--soft-head, #003057)' }}>
          {['No', '터미널', '고객명', '박스', ...Array.from({ length: slots }, (_, i) => `상품 ${i + 1}`)].map((label, i) => (
            <div key={i} className="flex items-center justify-center border-b-2 border-r border-white/20 px-2 py-1.5 last:border-r-0">
              {label}
            </div>
          ))}
        </div>
        {cards.map((card) => {
          const complete = cardIsComplete(card);
          const cancelled = cardIsCancelled(card);
          const badge = terminalBadgeProps(card.terminal, meta.terminals);
          return (
            <div key={card.id} data-ink-row={card.id} className="grid shrink-0 border-b border-slate-100" style={{ gridTemplateColumns: template, height: ROW_H, gridTemplateRows: `${ROW_H}px` }}>
              <div className="flex items-center justify-center border-r border-slate-100 bg-slate-50 px-2 text-[11px] leading-none font-bold text-slate-400">{labels.get(card.id)}</div>
              <div className="relative flex items-center justify-center border-r border-slate-100 px-2">
                <span className={`inline-block rounded-md border px-1.5 font-bold whitespace-nowrap ${badge.className}`} style={{ ...badge.style, fontSize: TERMINAL_FONT, lineHeight: 1.3 }}>
                  {card.terminal || '-'}
                </span>
              </div>
              <div className={`relative flex items-center overflow-hidden border-r border-slate-100 px-2 ${complete ? 'bg-emerald-50' : cancelled ? 'bg-rose-50' : ''}`}>
                {complete && <Check className="mr-0.5 shrink-0 text-emerald-700" size={NAME_FONT} strokeWidth={3} />}
                {cancelled && <X className="mr-0.5 shrink-0 text-rose-600" size={NAME_FONT} strokeWidth={3} />}
                {card.businessId && bothRounds.has(card.businessId) && <span className="mr-1 shrink-0 rounded bg-slate-200 px-1 text-[9px] leading-none font-bold text-slate-600">{card.round}차</span>}
                <span className={`leading-[1.15] font-bold break-keep whitespace-nowrap ${cancelled ? 'text-rose-700 line-through decoration-rose-400' : 'text-slate-700'}`} style={{ fontSize: NAME_FONT }}>
                  {card.name}
                </span>
              </div>
              <div className="flex items-center justify-center gap-1 border-r border-slate-100 bg-slate-50/60 px-1 whitespace-nowrap">
                <span className={`text-xs leading-none font-bold tabular-nums ${card.totalBoxes === null || cancelled ? 'text-slate-300' : 'text-slate-700'}`}>{cancelled ? '-' : (card.totalBoxes ?? '')}</span>
              </div>
              {Array.from({ length: slots }).map((_, i) => {
                const item = card.items[i];
                return item ? <Chip key={item.id} item={item} /> : <div key={i} className="border-r border-slate-100 last:border-r-0" />;
              })}
            </div>
          );
        })}
          </>
        )}
        <HistoryInk strokes={strokes} redrawKey={`${snapshotKey}|${group}${sepCompact ? 'c' : ''}|${slots}|${cards.length}|${scale.toFixed(3)}`} />
      </div>
    </div>
  );
}
