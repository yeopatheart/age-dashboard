'use client';
import { useRef } from 'react';
import { Cell } from './sheet-cell';
import { formatWon } from '@/lib/money';
import type { PriceEntry } from '@/lib/settlement/pricing';

// 오늘의 품목 단가표: 품목마다 판매 단가·기본 매입처·매입 단가를 한 번 정하면, 그 품목의 줄 중 값을 직접 고치지 않은 줄이 모두 이 값을 따른다.
// 같은 품목이어도 줄에서 매입처·단가를 따로 고칠 수 있다(정산표의 매입처·매입단가 칸).
export interface PriceRowInfo {
  product: string;
  lines: number; // 오늘 그 품목 줄 수
  quantity: number; // 수량 합
  entry: PriceEntry;
}

type PriceCol = 'sale' | 'supplier' | 'purchase';
const COLS: PriceCol[] = ['sale', 'supplier', 'purchase'];

export function PriceTable({
  rows,
  supplierName,
  canEdit,
  canCopy,
  onCommit,
  onCopyPrevious,
}: {
  rows: PriceRowInfo[];
  supplierName: (id: string | null) => string;
  canEdit: boolean;
  canCopy: boolean; // 어제 단가 불러오기를 보여 줄지(단가표 테이블이 있을 때)
  onCommit: (product: string, col: PriceCol, text: string) => void;
  onCopyPrevious: () => void;
}) {
  const ref = useRef<HTMLTableElement>(null);
  const cell = (r: number, c: PriceCol) => ref.current?.querySelector<HTMLInputElement>(`input[data-pr="${r}"][data-pc="${c}"]`) ?? null;
  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.dataset.pr === undefined || e.nativeEvent.isComposing) return;
    const r = Number(t.dataset.pr);
    const c = t.dataset.pc as PriceCol;
    const go = (el: HTMLInputElement | null) => el?.focus();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (cell(r + (e.shiftKey ? -1 : 1), c)) go(cell(r + (e.shiftKey ? -1 : 1), c));
      else t.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      go(cell(r + 1, c));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      go(cell(r - 1, c));
    } else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) {
      e.preventDefault();
      go(cell(r, COLS[COLS.indexOf(c) - 1]));
    } else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length && t.selectionEnd === t.value.length) {
      e.preventDefault();
      go(cell(r, COLS[COLS.indexOf(c) + 1]));
    }
  };

  if (rows.length === 0) return null;
  return (
    <div className="st-prices">
      <div className="ak-toolbar" style={{ boxShadow: 'none' }}>
        <strong>오늘의 품목 단가</strong>
        <span className="ak-sub">품목마다 한 번 정하면 그 품목의 줄이 모두 따릅니다. 줄에서 고친 값이 있으면 그 줄은 줄 값이 우선합니다.</span>
        <span className="ak-spacer" />
        {canEdit && canCopy && <button className="ak-btn" onClick={onCopyPrevious} title="가장 최근 단가표에서 오늘 아직 비어 있는 품목의 단가·매입처를 불러옵니다">이전 단가 불러오기</button>}
      </div>
      <div className="ak-table-wrap" style={{ maxHeight: '18rem' }}>
        <table className="ak-table st-price-table" ref={ref} onKeyDown={onKeyDown}>
          <thead>
            <tr>
              <th scope="col">품목</th>
              <th scope="col" className="ak-right">줄 · 수량</th>
              <th scope="col" className="ak-right">판매 단가</th>
              <th scope="col">기본 매입처</th>
              <th scope="col" className="ak-right">매입 단가</th>
              <th scope="col" className="ak-right">마진</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const { saleUnitPrice: sale, purchaseUnitPrice: buy } = p.entry;
              const margin = sale !== null && buy !== null && sale > 0 ? Math.round(((sale - buy) / sale) * 100) : null;
              return (
                <tr key={p.product}>
                  <td><strong style={{ padding: '0 0.45rem' }}>{p.product}</strong></td>
                  <td className="ak-right ak-sub">{p.lines}줄 · {Number(p.quantity.toFixed(2))}</td>
                  <td><Cell grid="price" r={i} c="sale" numeric value={formatWon(sale)} label={`${p.product} 판매 단가`} disabled={!canEdit} onCommit={(t) => onCommit(p.product, 'sale', t)} /></td>
                  <td><Cell grid="price" r={i} c="supplier" value={supplierName(p.entry.supplierId)} label={`${p.product} 기본 매입처`} disabled={!canEdit} list="st-suppliers" onCommit={(t) => onCommit(p.product, 'supplier', t)} /></td>
                  <td><Cell grid="price" r={i} c="purchase" numeric value={formatWon(buy)} label={`${p.product} 매입 단가`} disabled={!canEdit} onCommit={(t) => onCommit(p.product, 'purchase', t)} /></td>
                  <td className="ak-right ak-sub" style={{ color: margin !== null && margin < 0 ? '#b91c1c' : undefined }}>{margin === null ? '' : `${margin}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
