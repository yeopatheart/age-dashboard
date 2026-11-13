'use client';
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ProductCustomer, ProductSummaryRow } from '@/lib/orders';
import { placePopover, type Rect4 } from '@/lib/popover-position';

// 품목별 수량의 상품 칩을 누르면 그 옆에 뜨는 플로팅 카드: 이 상품을 주문한 고객사와 고객사별 수량.
// 고객명은 절대 가려지면 안 되므로 말줄임 없이 줄바꿈한다. 바깥을 누르거나 Esc로 닫는다.
const WIDTH = 288;
const ROW_H = 32;

export function ProductCustomersPopover({ product, customers, anchor, chipStyle, onClose }: { product: ProductSummaryRow; customers: ProductCustomer[]; anchor: Rect4; chipStyle: React.CSSProperties; onClose: () => void }) {
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
              {product.added > 0 && <span className="ml-1">(+{product.added} 추가)</span>}
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
            {customers.map((c) => (
              <li key={c.dailyBusinessId} className="flex items-start gap-2 px-3 py-1.5" style={{ minHeight: ROW_H }}>
                <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${c.allPacked && !c.undecided && c.quantity > 0 ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`} aria-label={c.allPacked ? '포장 완료' : '포장 전'}>
                  {c.allPacked && !c.undecided && c.quantity > 0 && <Check className="h-3 w-3" strokeWidth={4} />}
                </span>
                <span className="min-w-0 flex-1 break-keep text-sm font-bold leading-snug text-slate-800">{c.name}</span>
                <span className="flex flex-shrink-0 flex-col items-end text-sm font-black leading-snug text-slate-900">
                  {c.undecided ? <span className="text-xs text-amber-700">수량 미정</span> : c.quantity > 0 && <span>{c.quantity}{product.unit}</span>}
                  {c.unshipped > 0 && <span className="text-xs font-bold text-amber-700">미출고 {c.unshipped}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
