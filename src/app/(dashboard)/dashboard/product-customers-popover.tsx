'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import { formatDelta, productDelta, type ProductCustomer, type ProductSummaryRow } from '@/lib/orders';
import { placePopover, type Rect4 } from '@/lib/popover-position';

// 품목별 수량의 상품 칩을 누르면 그 옆에 뜨는 플로팅 카드: 이 상품을 주문한 고객사와 고객사별 수량.
// 고객명은 절대 가려지면 안 되므로 말줄임 없이 줄바꿈한다. 바깥을 누르거나 Esc로 닫는다.
// 수정 권한이 있고 펜이 꺼져 있으면(canEdit) 줄을 눌러 포장 완료를 켜고 끌 수 있고(주문 목록의 상품 칸과 같은 상태), 수량을 −/+ 또는 직접 입력으로 바꿀 수 있다(주문 수정과 같은 저장).
const WIDTH = 328;
const ROW_H = 40;
const QUANTITY_COMMIT_MS = 600; // −/+를 연달아 눌러도 마지막 값만 저장하도록 모으는 시간

// 수량 칸: 값은 이 칸에서 먼저 보여 주고(−/+ 즉시 반영), 멈추면 한 번만 저장한다. 서버 값이 바뀌면(다른 기기·주문 목록에서 고침) 그 값을 따라간다.
function QuantityStepper({ value, unit, onCommit }: { value: number; unit: string; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = draft ?? String(value);
  const commit = (raw: string) => {
    clearTimeout(timer.current);
    setDraft(null);
    const next = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(next) && next > 0 && next !== value) onCommit(next);
  };
  const step = (delta: number) => {
    const next = Math.round((Number(shown) + delta) * 100) / 100;
    if (!(next > 0)) return;
    setDraft(String(next));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(String(next)), QUANTITY_COMMIT_MS);
  };
  const btn = 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100';
  return (
    <div className="flex flex-shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={btn} onClick={() => step(-1)} aria-label="수량 줄이기"><Minus className="h-4 w-4" /></button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-8 w-14 rounded-lg border border-slate-300 bg-white text-center text-sm font-black tabular-nums text-slate-900"
        aria-label="수량"
      />
      <span className="w-5 flex-shrink-0 text-xs font-semibold text-slate-500">{unit}</span>
      <button type="button" className={btn} onClick={() => step(1)} aria-label="수량 늘리기"><Plus className="h-4 w-4" /></button>
    </div>
  );
}

export function ProductCustomersPopover({
  product,
  customers,
  anchor,
  chipStyle,
  canEdit,
  onSetPacked,
  onChangeQuantity,
  onClose,
}: {
  product: ProductSummaryRow;
  customers: ProductCustomer[];
  anchor: Rect4;
  chipStyle: React.CSSProperties;
  canEdit: boolean;
  onSetPacked: (lineIds: string[], packed: boolean) => void;
  onChangeQuantity: (lineId: string, quantity: number) => void;
  onClose: () => void;
}) {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const maxHeight = Math.round(viewport.height * 0.7);
  const height = Math.min(maxHeight, 64 + customers.length * ROW_H);
  const pos = placePopover(anchor, { width: WIDTH, height }, viewport);
  const total = product.undecided > 0 ? '수량 미정' : `${product.total}${product.unit}`;

  return (
    <>
      <div className="fixed inset-0 z-[70]" onPointerDown={onClose} />
      <div role="dialog" aria-label={`${product.label}을(를) 주문한 고객사`} className="fixed z-[71] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight }}>
        <div className="flex flex-shrink-0 items-start justify-between gap-2 border-b px-3 py-2" style={chipStyle}>
          <div className="min-w-0">
            <p className="break-keep text-sm font-black leading-tight">{product.label}</p>
            <p className="mt-0.5 text-xs font-bold opacity-80">
              {customers.length}곳 · 총 {total}
              {productDelta(product) !== 0 && <span className="ml-1">({formatDelta(productDelta(product), product.unit)} 변경)</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/60 hover:bg-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        {customers.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">이 상품을 주문한 고객사가 없습니다.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {customers.map((c) => {
              const done = c.allPacked && !c.undecided && c.lines.length > 0;
              const packable = canEdit && c.lines.length > 0 && !c.undecided;
              const single = c.lines.length === 1 ? c.lines[0] : null;
              return (
                <li
                  key={c.dailyBusinessId}
                  className={`flex items-center gap-2 px-3 py-1 ${packable ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                  style={{ minHeight: ROW_H }}
                  onClick={packable ? () => onSetPacked(c.lines.map((l) => l.id), !c.allPacked) : undefined}
                >
                  <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`} role={packable ? 'checkbox' : undefined} aria-checked={packable ? done : undefined} aria-label={done ? '포장 완료' : '포장 전'}>
                    {done && <Check className="h-3.5 w-3.5" strokeWidth={4} />}
                  </span>
                  <span className={`min-w-0 flex-1 break-keep text-sm font-bold leading-snug ${done ? 'text-slate-400' : 'text-slate-800'}`}>{c.name}</span>
                  {c.undecided ? (
                    <span className="flex-shrink-0 text-xs font-black text-amber-700">수량 미정</span>
                  ) : canEdit && single ? (
                    <QuantityStepper key={`${single.id}:${single.quantity}`} value={single.quantity} unit={product.unit} onCommit={(q) => onChangeQuantity(single.id, q)} />
                  ) : (
                    <span className="flex flex-shrink-0 flex-col items-end text-sm font-black leading-snug text-slate-900" title={c.lines.length > 1 ? '같은 상품이 여러 줄입니다 — 고객명을 눌러 줄마다 수정하세요' : undefined}>
                      {c.quantity > 0 && <span>{c.quantity}{product.unit}</span>}
                    </span>
                  )}
                  {c.unshipped > 0 && <span className="flex-shrink-0 text-xs font-bold text-amber-700">미출고 {c.unshipped}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
