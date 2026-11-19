import { Check, X } from 'lucide-react';
import { cardIsCancelled, cardIsComplete, itemIsUndecided, type SnapshotMeta, type SummaryCard, type SummaryItem } from '@/lib/ink/history-view';
import { prepLabelOf, roundLabel } from '@/lib/orders';
import { terminalBadgeProps } from '@/lib/terminal-color';

// 별도 주문 탭의 표 머리와 줄. 칠판의 별도 주문 팝업(dashboard-client.tsx의 separateOpen 부분)을 따라 만든 읽기 전용 복제본이다:
// 줄은 칩이 정하는 높이(칩 최소 44px + 칸 여백)로 자라고 칩은 여러 줄로 줄바꿈된다. 필기가 줄·칩 박스에 대한 비율로 저장되므로
// 이 높이·칩 모양이 칠판과 같아야 필기가 늘어나거나 눌리지 않는다(2026-11-19: 18px 줄로 그렸더니 필기가 가로로 늘어나 보였다).
// 칠판은 주문이 많으면 줄 여백을 한 단계씩 줄이지만(옛 SEP_DENSITIES) 그 단계가 저장돼 있지 않아서 가장 넉넉한 단계(0)로 그린다.
//
// 두 가지 모양이 있다(order_date로 고른다: SEP_COMPACT_FROM):
//  - compact(2026-11-20 영업부터): 한 쪽 20줄·줄 29px(칩 최소 26px + 칸 여백 2px + 테두리 1px). 완료·취소는 아이콘, 업체 메모는 점 + 상품 뒤 빈 칸의 글.
//  - legacy(그 전 날짜): 줄 51px, 글자 배지, 메모는 고객명 아래 글. 이 갈래(legacy 표시)는 그 날짜 이력이 모두 보관 기간을 넘겨 사라지면 지운다.

// 칠판 getItemStyle과 같은 상태별 색. 미출고(점선)·포장 완료(회색)·추가(초록)·수정(노랑)·취소(빨강 취소선)·최초 주문(진한 테두리).
export function itemColors(status: SummaryItem['status'], packed: boolean, unshipped: number, qty: number) {
  if (unshipped > 0 && status !== 'cancelled') {
    return unshipped >= qty ? { bg: 'bg-amber-100', border: 'border-amber-500 border-dashed', text: 'text-amber-900' } : { bg: 'bg-amber-50', border: 'border-amber-500 border-dashed', text: 'text-slate-900' };
  }
  if (packed && status !== 'cancelled') return { bg: 'bg-slate-100', border: 'border-slate-300', text: 'text-slate-400' };
  switch (status) {
    case 'new':
      return { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700' };
    case 'modified':
      return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700' };
    case 'cancelled':
      return { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-600 line-through' };
    default:
      return { bg: 'bg-slate-50', border: 'border-slate-800', text: 'text-slate-900' };
  }
}

export function SepHeader({ template, slots }: { template: string; slots: number }) {
  return (
    <div className="soft-head-line grid text-xs font-bold text-white" style={{ backgroundColor: 'var(--soft-head, #003057)', gridTemplateColumns: template, height: 30 }}>
      <div className="flex items-center justify-center border-r border-b-2 border-white/20 px-2">No</div>
      <div className="flex items-center justify-center border-r border-b-2 border-white/20 px-2">터미널</div>
      <div className="flex items-center border-r border-b-2 border-white/20 px-3">고객명</div>
      <div className="flex items-center justify-center border-r border-b-2 border-white/20 px-2">박스</div>
      {Array.from({ length: slots }).map((_, i) => (
        <div key={i} className="flex items-center justify-center border-r border-b-2 border-white/20 px-1.5 text-center last:border-r-0">
          상품 {i + 1}
        </div>
      ))}
    </div>
  );
}

function SepChip({ item, compact }: { item: SummaryItem; compact: boolean }) {
  const { bg, border, text } = itemColors(item.status, item.packed, item.unshipped, item.qty);
  const cancelled = item.status === 'cancelled';
  const suffix: string[] = [];
  if (item.secondaryKg !== null) suffix.push(`${item.secondaryKg}kg`);
  if (item.size) suffix.push(item.size);
  const prep = prepLabelOf({ isMulbong: item.isMulbong, hasAerator: item.hasAerator });
  if (prep) suffix.push(prep);
  return (
    <div className={`flex min-w-0 border-r border-slate-100 last:border-r-0 ${compact ? 'p-[1px]' : 'p-[3px]'}`}>
      <div data-chip={item.id} className={`relative flex w-full flex-wrap content-center items-center justify-start gap-x-1 border text-left text-xs break-keep shadow-sm [overflow-wrap:anywhere] ${compact ? 'min-h-[26px] rounded px-1 py-0' : 'min-h-[44px] rounded-lg px-1.5 py-1'} ${bg} ${border} ${text}`}>
        <span className="font-bold">{item.name}</span>
        {itemIsUndecided(item) ? (
          <span className="whitespace-nowrap rounded bg-amber-100 px-1 font-black text-amber-700">수량 미정</span>
        ) : (
          <span className="whitespace-nowrap">
            <span className="text-sm font-black">{item.qty}</span>
            <span className="ml-0.5 font-semibold">{item.unit}</span>
          </span>
        )}
        {suffix.length > 0 && <span className="font-semibold text-sky-600">({suffix.join(', ')})</span>}
        {item.unshipped > 0 && !cancelled && (
          <span className="rounded bg-amber-500 px-1 py-[1px] text-[10px] font-bold text-white" title={item.unshippedReason ?? undefined}>
            미출고 {item.unshipped}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ kind }: { kind: 'done' | 'cancelled' }) {
  return (
    <span className="inline-flex shrink-0 items-center" style={{ width: 14 }}>
      {kind === 'done' ? <Check width={12} height={12} strokeWidth={4} className="text-emerald-600" aria-label="완료" /> : <X width={12} height={12} strokeWidth={4} className="text-rose-600" aria-label="취소" />}
    </span>
  );
}

export function SepRow({ card, label, template, slots, meta, bothRounds, compact }: { card: SummaryCard; label: string | undefined; template: string; slots: number; meta: SnapshotMeta; bothRounds: boolean; compact: boolean }) {
  const complete = cardIsComplete(card);
  const cancelled = cardIsCancelled(card);
  const badge = terminalBadgeProps(card.terminal, meta.terminals);
  const renamed = card.defaultName !== '' && card.name !== card.defaultName;
  const roundBadge = bothRounds && (
    <span className={`mr-1 inline-block rounded border px-1 align-middle font-bold ${compact ? 'text-[9px] leading-[10px]' : 'text-[10px] leading-[14px]'} ${card.round === 1 ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-violet-200 bg-violet-50 text-violet-700'}`}>{roundLabel(card.round)}</span>
  );
  const boxes = (
    <span className={`font-bold tabular-nums ${compact ? 'text-xs leading-none' : 'text-sm'} ${card.totalBoxes === null || cancelled ? 'text-slate-300' : 'text-slate-700'}`}>{cancelled ? '-' : (card.totalBoxes ?? '-')}</span>
  );
  const merge = card.hasMerge && <span className={`rounded border border-emerald-300 bg-emerald-50 px-1 text-[10px] font-bold text-emerald-800 ${compact ? 'leading-[10px]' : ''}`}>합</span>;
  return (
    <div data-ink-row={card.id} className="grid border-b border-slate-100 bg-white" style={{ gridTemplateColumns: template }}>
      <div className={`flex items-center justify-center border-r border-slate-100 bg-slate-50 px-2 font-bold whitespace-nowrap text-slate-400 ${compact ? 'text-[11px] leading-none' : 'text-xs'}`}>
        <div className={`flex w-full items-center justify-center ${compact ? 'min-h-[26px]' : 'min-h-[44px]'}`}>{label}</div>
      </div>
      <div className="flex items-center justify-center border-r border-slate-100 px-2">
        <span className={`inline-block rounded-md border font-bold whitespace-nowrap ${compact ? 'px-1.5 text-[11px] leading-[18px]' : 'px-2 py-0.5 text-[11px]'} ${badge.className}`} style={badge.style}>
          {card.terminal || '-'}
        </span>
      </div>
      {compact ? (
        <div className={`flex min-w-0 items-center border-r border-slate-100 px-2 ${complete ? 'bg-emerald-50' : cancelled ? 'bg-rose-50' : ''}`}>
          {complete && <StatusIcon kind="done" />}
          {cancelled && <StatusIcon kind="cancelled" />}
          <span className={`text-xs leading-[1.15] font-bold break-keep ${cancelled ? 'text-rose-700 line-through decoration-rose-400' : 'text-slate-800'}`}>
            {roundBadge}
            <span className="inline-flex items-baseline gap-1">
              <span>{card.name}</span>
              {renamed && <span className="text-[10px] font-bold text-sky-600">(변경)</span>}
            </span>
          </span>
          {card.memo && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
        </div>
      ) : (
        <div className={`flex min-w-0 flex-col justify-center gap-0.5 border-r border-slate-100 px-3 py-1.5 ${complete ? 'bg-emerald-50' : cancelled ? 'bg-rose-50' : ''}`}>
          <span className={`text-sm leading-tight font-bold break-keep ${cancelled ? 'text-rose-700' : 'text-slate-800'}`}>
            {complete && (
              <span className="mr-1 inline-flex items-center gap-0.5 rounded border border-emerald-400 bg-emerald-100 px-1 align-middle text-[10px] leading-[14px] font-extrabold text-emerald-800">
                <Check className="h-2.5 w-2.5" strokeWidth={4} />
                완료
              </span>
            )}
            {cancelled && <span className="mr-1 inline-flex items-center rounded border border-rose-300 bg-rose-100 px-1 align-middle text-[10px] leading-[14px] font-extrabold text-rose-700">취소</span>}
            {roundBadge}
            <span className="inline-flex items-baseline gap-1">
              <span>{card.name}</span>
              {renamed && <span className="text-[10px] font-bold text-sky-600">(변경)</span>}
            </span>
          </span>
          {card.memo && <span className="text-[11px] leading-tight font-bold text-amber-700">메모: {card.memo}</span>}
        </div>
      )}
      <div className="flex items-center justify-center gap-1 border-r border-slate-100 bg-slate-50/60 px-1 whitespace-nowrap">
        {boxes}
        {merge}
      </div>
      {Array.from({ length: slots }).map((_, i) => {
        const item = card.items[i];
        if (!item) {
          // compact: 업체 메모는 상품이 끝난 뒤 남는 빈 칸들을 하나로 합쳐 보인다(주문 목록과 같은 규칙). 칸이 모자라면 이름 옆 점만 있다.
          if (compact && card.memo) {
            if (i !== card.items.length) return null;
            return (
              <div key={i} className="flex items-center overflow-hidden bg-amber-50/60 px-2 text-[11px] leading-[1.15] font-bold text-amber-700" style={{ gridColumn: `span ${slots - i}` }}>
                <span className="line-clamp-1">메모: {card.memo}</span>
              </div>
            );
          }
          return <div key={i} className="border-r border-slate-100 last:border-r-0" />;
        }
        return <SepChip key={item.id} item={item} compact={compact} />;
      })}
    </div>
  );
}
