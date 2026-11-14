'use client';
import { useEffect, useState } from 'react';
import { Check, PackageX, Pencil, Plus, Trash2, X } from 'lucide-react';
import { isUndecidedQuantity, prepLabelOf, type OrderItem, type OrderRow } from '@/lib/orders';
import { placePopover, type Rect4 } from '@/lib/popover-position';

// 주문 목록에서 고객명을 누르면 그 옆에 뜨는 패널: 이 고객의 주문을 고치는 모든 동작(상품 추가·수정·미출고·취소·삭제, 주문 수정·삭제)이 여기에 있다.
// 상품 칸 위에서는 포장 완료만 되고 나머지는 전부 이 패널에서 한다(2026-11-14). 고객명은 말줄임 없이 줄바꿈한다. 바깥을 누르거나 Esc로 닫는다.
const WIDTH = 344;
const HEADER_H = 52;
const ACTIONS_H = 48;
const ROW_H = 46;

interface Props {
  row: OrderRow;
  items: OrderItem[];
  anchor: Rect4;
  canDelete: boolean;
  onClose: () => void;
  onAddItem: () => void;
  onEditOrder: () => void;
  onDeleteOrder: () => void;
  onEditItem: (item: OrderItem) => void;
  onUnshipped: (item: OrderItem) => void;
  onCancelItem: (item: OrderItem) => void;
  onDeleteItem: (item: OrderItem) => void;
}

const iconButton = 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white transition-colors';

export function CustomerOrderPanel({ row, items, anchor, canDelete, onClose, onAddItem, onEditOrder, onDeleteOrder, onEditItem, onUnshipped, onCancelItem, onDeleteItem }: Props) {
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

  const maxHeight = Math.round(viewport.height * 0.8);
  const height = Math.min(maxHeight, HEADER_H + ACTIONS_H + Math.max(1, items.length) * ROW_H + 8);
  const pos = placePopover(anchor, { width: WIDTH, height }, viewport);

  return (
    <>
      <div className="fixed inset-0 z-[70]" onPointerDown={onClose} />
      <div role="dialog" aria-label={`${row.businessName} 주문`} className="fixed z-[71] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight }}>
        <div className="flex flex-shrink-0 items-start justify-between gap-2 px-3 py-2" style={{ backgroundColor: '#003057' }}>
          <div className="min-w-0">
            <p className="break-keep text-sm font-black leading-tight text-white">{row.businessName}</p>
            <p className="mt-0.5 text-xs font-bold text-white/70">
              {row.terminal || '터미널 없음'} · 박스 {row.totalBoxes ?? '-'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-2">
          <button type="button" onClick={onAddItem} className="flex h-8 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-xs font-bold text-white hover:bg-sky-700">
            <Plus className="h-3.5 w-3.5" />상품 추가
          </button>
          <button type="button" onClick={onEditOrder} className="flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
            <Pencil className="h-3.5 w-3.5" />주문 수정
          </button>
          {canDelete && (
            <button type="button" onClick={onDeleteOrder} className="ml-auto flex h-8 items-center gap-1 rounded-lg bg-rose-50 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-500 hover:text-white" title="이 날짜의 주문 삭제 (고객사 관리의 고객사는 그대로입니다)">
              <Trash2 className="h-3.5 w-3.5" />주문 삭제
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">등록된 상품이 없습니다. 위의 상품 추가로 넣어 주세요.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {items.map((item) => {
              const cancelled = item.changeStatus === 'cancelled';
              const suffixParts: string[] = [];
              if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
              if (item.sizeRequest) suffixParts.push(item.sizeRequest);
              const prep = prepLabelOf(item);
              if (prep) suffixParts.push(prep);
              return (
                <li key={item.id} className="flex items-center gap-2 px-3 py-1" style={{ minHeight: ROW_H }}>
                  <div className={`min-w-0 flex-1 leading-snug ${cancelled ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    <p className="break-keep text-sm font-bold">
                      {item.productName}{' '}
                      {isUndecidedQuantity(item) ? (
                        <span className="rounded bg-amber-100 px-1 text-xs font-black text-amber-700 no-underline">수량 미정</span>
                      ) : (
                        <span className="font-black">{item.quantity}{item.unit}</span>
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold text-slate-500">
                      {suffixParts.length > 0 && <span className="text-sky-600">{suffixParts.join(', ')}</span>}
                      {cancelled && <span className="font-bold text-rose-600 no-underline">취소됨</span>}
                      {!cancelled && item.unshippedQuantity > 0 && <span className="font-bold text-amber-700">미출고 {item.unshippedQuantity}</span>}
                      {!cancelled && item.isPacked && <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600"><Check className="h-3 w-3" strokeWidth={4} />포장 완료</span>}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button type="button" onClick={() => onEditItem(item)} className={`${iconButton} bg-slate-600 hover:bg-slate-800`} title="수정" aria-label={`${item.productName} 수정`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    {!cancelled && (
                      <button type="button" onClick={() => onUnshipped(item)} className={`${iconButton} bg-indigo-500 hover:bg-indigo-700`} title="미출고 처리 (주문은 유효, 출고만 못 함)" aria-label={`${item.productName} 미출고 처리`}>
                        <PackageX className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && !cancelled && (
                      <button type="button" onClick={() => onCancelItem(item)} className={`${iconButton} bg-amber-400 hover:bg-amber-500`} title="주문 취소 (주문 자체가 없어짐)" aria-label={`${item.productName} 주문 취소`}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => onDeleteItem(item)} className={`${iconButton} bg-rose-400 hover:bg-rose-600`} title="삭제" aria-label={`${item.productName} 삭제`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
