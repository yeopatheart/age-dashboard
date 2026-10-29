'use client';
import { useState, type ReactNode } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Ban, Check, ChevronDown, ChevronLeft, ChevronRight, GripVertical, ListChecks, PackageX, Pencil, Plus, Trash2, X } from 'lucide-react';
import { getProductSummary, isCardComplete, isUndecidedQuantity, roundLabel, type OrderItem, type OrderRound, type OrderRow } from '@/lib/orders';
import { BoxDots } from '@/components/box-dots';
import { STAGE_LABEL, stageDetail, stageOf } from '@/lib/overview';
import { terminalBadgeProps, type TerminalColorMap } from '@/lib/terminal-color';

// 휴대폰(768px 이하)용 대시보드. PC의 "고객 × 상품" 표를 가로로 밀어 보는 대신, 고객 한 곳이 카드 하나다.
//  - 맨 위(고정): 날짜 이동, 전체 진행 요약, 터미널 칩(필터), 상태 필터. 기본은 "미완료"만 보인다.
//  - 카드: 터미널·고객명·박스 수·진행률(포장 n/m)과 예외(신규·수정·취소·미출고)가 접은 상태에서도 보이고, 누르면 상품 전체가 펼쳐진다.
//  - 상품을 누르면 아래에서 올라오는 시트에서 포장 체크·수정·미출고·취소·삭제를 한다(오터치를 막으려고 카드 안 직접 편집은 두지 않는다).
// 데이터·서버 기능·권한은 PC 화면과 같고 DashboardClient가 넘겨준다. 순서 드래그는 모바일에서 쓰지 않는다(스크롤과 부딪힌다).
type Segment = 'main' | 'separate';
type StatusFilter = 'pending' | 'all' | 'done' | 'changed';
type ViewMode = 'customers' | 'products';

export interface DashboardMobileProps {
  orderDate: string;
  today: string;
  mainRows: OrderRow[];
  separateRows: OrderRow[];
  items: OrderItem[];
  terminalColors: TerminalColorMap;
  roundOf: (row: OrderRow) => OrderRound | null;
  readOnly: boolean;
  canDelete: boolean;
  onSetDate: (date: string) => void;
  onTogglePacked: (item: OrderItem) => void;
  onEditItem: (item: OrderItem) => void;
  onAddItem: (row: OrderRow) => void;
  onUnshipped: (item: OrderItem) => void;
  onCancelItem: (item: OrderItem) => void;
  onDeleteItem: (item: OrderItem) => void;
  onDeleteOrder: (row: OrderRow) => void;
  // 오늘 날짜에 고객(주문) 카드를 새로 추가하는 창을 연다(PC의 + 버튼과 같은 창)
  onAddOrder: () => void;
  // 카드를 끌어 순서를 바꿨을 때: 그 구분(기본/별도) 전체의 새 순서(id 배열)
  onReorder: (segment: 'main' | 'separate', orderedIds: string[]) => void;
}

const isDone = (i: OrderItem) => !isUndecidedQuantity(i) && (i.isPacked || i.quantity - i.unshippedQuantity <= 0);
const isLive = (i: OrderItem) => i.changeStatus !== 'cancelled';

function detailOf(item: OrderItem): string {
  if (isUndecidedQuantity(item)) return '수량 미정';
  const parts = [`${item.quantity}${item.unit}`];
  const extra = [item.secondaryWeightKg != null ? `${item.secondaryWeightKg}kg` : null, item.sizeRequest].filter(Boolean).join(', ');
  if (extra) parts.push(`(${extra})`);
  return parts.join(' ');
}

interface Stats {
  live: number;
  done: number;
  added: number;
  modified: number;
  cancelled: number;
  unshipped: number;
  undecided: number;
}

function statsOf(rowItems: OrderItem[]): Stats {
  const live = rowItems.filter(isLive);
  return {
    live: live.length,
    done: live.filter(isDone).length,
    added: live.filter((i) => i.changeStatus === 'new').length,
    modified: live.filter((i) => i.changeStatus === 'modified').length,
    cancelled: rowItems.length - live.length,
    unshipped: live.filter((i) => i.unshippedQuantity > 0).length,
    undecided: live.filter(isUndecidedQuantity).length,
  };
}
const hasException = (s: Stats, row: OrderRow) => s.added + s.modified + s.cancelled + s.unshipped + s.undecided > 0 || !!row.packingChanged;

// 고객 카드 한 장. 순서는 카드 오른쪽 끝의 손잡이를 끌어서만 바꾼다(카드 전체를 끌게 하면 목록을 스크롤하다가 순서가 바뀐다).
function SortableCard({ id, disabled, className, children }: { id: string; disabled: boolean; className: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = disabled ? null : (
    <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="dm-grip" aria-label="끌어서 순서 변경" title="끌어서 순서 변경">
      <GripVertical size={18} />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      className={`${className} ${isDragging ? 'dm-dragging' : ''}`}
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
    >
      {children(handle)}
    </li>
  );
}

export function DashboardMobile(props: DashboardMobileProps) {
  const { orderDate, today, mainRows, separateRows, items, terminalColors, roundOf, readOnly, canDelete } = props;
  const [segment, setSegment] = useState<Segment>('main');
  const [terminal, setTerminal] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [view, setView] = useState<ViewMode>('customers');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);

  const segmentRows = segment === 'main' ? mainRows : separateRows;
  const itemsByRow = new Map<string, OrderItem[]>();
  for (const i of items) itemsByRow.set(i.dailyBusinessId, [...(itemsByRow.get(i.dailyBusinessId) ?? []), i]);
  for (const list of itemsByRow.values()) list.sort((a, b) => a.productSequence - b.productSequence);
  const statsByRow = new Map(segmentRows.map((r) => [r.dailyBusinessId, statsOf(itemsByRow.get(r.dailyBusinessId) ?? [])]));

  // 터미널 칩: 이 구분(기본/별도)의 터미널별 고객 수와 박스 합계
  const terminalMap = new Map<string, { customers: number; boxes: number }>();
  for (const r of segmentRows) {
    const t = terminalMap.get(r.terminal) ?? { customers: 0, boxes: 0 };
    t.customers += 1;
    t.boxes += r.totalBoxes ?? 0;
    terminalMap.set(r.terminal, t);
  }
  const terminals = [...terminalMap.entries()].map(([name, v]) => ({ name, ...v }));

  const byTerminal = terminal ? segmentRows.filter((r) => r.terminal === terminal) : segmentRows;
  const doneRow = (r: OrderRow) => isCardComplete(itemsByRow.get(r.dailyBusinessId) ?? []);
  const counts = {
    all: byTerminal.length,
    pending: byTerminal.filter((r) => !doneRow(r)).length,
    done: byTerminal.filter(doneRow).length,
    changed: byTerminal.filter((r) => hasException(statsByRow.get(r.dailyBusinessId)!, r)).length,
  };
  const visible = byTerminal.filter((r) => {
    if (status === 'pending') return !doneRow(r);
    if (status === 'done') return doneRow(r);
    if (status === 'changed') return hasException(statsByRow.get(r.dailyBusinessId)!, r);
    return true;
  });

  const totals = byTerminal.reduce(
    (acc, r) => {
      const s = statsByRow.get(r.dailyBusinessId)!;
      return { live: acc.live + s.live, done: acc.done + s.done };
    },
    { live: 0, done: 0 },
  );
  const pct = totals.live ? Math.round((totals.done / totals.live) * 100) : 0;

  const terminalRowIds = new Set(byTerminal.map((r) => r.dailyBusinessId));
  const productRows = getProductSummary(items.filter((i) => terminalRowIds.has(i.dailyBusinessId)));

  // 순서 드래그: 화면에 보이는 카드(필터 적용 후)끼리만 자리를 바꾸고, 가려진 카드는 제자리에 둔다.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const canReorder = !readOnly && view === 'customers';
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = visible.findIndex((r) => r.dailyBusinessId === active.id);
    const to = visible.findIndex((r) => r.dailyBusinessId === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(visible, from, to).map((r) => r.dailyBusinessId);
    const visibleIds = new Set(visible.map((r) => r.dailyBusinessId));
    let cursor = 0;
    props.onReorder(segment, segmentRows.map((r) => (visibleIds.has(r.dailyBusinessId) ? moved[cursor++] : r.dailyBusinessId)));
  };

  const sheetItem = items.find((i) => i.id === sheetItemId) ?? null;
  const sheetRow = sheetItem ? [...mainRows, ...separateRows].find((r) => r.dailyBusinessId === sheetItem.dailyBusinessId) ?? null : null;
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shiftDate = (days: number) => {
    const d = new Date(`${orderDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    props.onSetDate(d.toISOString().slice(0, 10));
  };

  const switchSegment = (next: Segment) => {
    if (next === segment) return;
    setSegment(next);
    setTerminal(null); // 터미널 칩은 구분마다 다르다
  };

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: counts.all },
    { key: 'pending', label: '미완료', count: counts.pending },
    { key: 'done', label: '완료', count: counts.done },
    { key: 'changed', label: '변경·예외', count: counts.changed },
  ];

  return (
    <div className="dm-root">
      <div className="dm-head">
        <div className="dm-date">
          <div className="dm-date-nav">
            <button className="dm-icon" onClick={() => shiftDate(-1)} aria-label="전날"><ChevronLeft size={18} /></button>
            <label className="dm-date-label">
              <input type="date" value={orderDate} max={today} onChange={(e) => e.target.value && props.onSetDate(e.target.value)} />
              <span>{orderDate.slice(5).replace('-', '/')}{orderDate === today ? ' · 오늘' : ''}</span>
            </label>
            <button className="dm-icon" onClick={() => shiftDate(1)} disabled={orderDate >= today} aria-label="다음날"><ChevronRight size={18} /></button>
            {orderDate !== today && <button className="dm-today" onClick={() => props.onSetDate(today)}>오늘</button>}
          </div>
          {!readOnly && (
            <button className="dm-add" onClick={props.onAddOrder} aria-label="주문 추가" title="주문 추가 (고객 카드 추가)">
              <Plus size={20} strokeWidth={2.5} />
            </button>
          )}
          {/* 기본 주문 ↔ 별도 주문(택배 등) 전환. 아래 터미널 칩·진행·상태 필터가 고른 구분에 맞춰 바뀐다. */}
          <div className="dm-toggle" role="tablist" aria-label="주문 구분">
            <button role="tab" aria-selected={segment === 'main'} className={segment === 'main' ? 'dm-toggle-on' : ''} onClick={() => switchSegment('main')}>기본</button>
            <button role="tab" aria-selected={segment === 'separate'} className={segment === 'separate' ? 'dm-toggle-on' : ''} onClick={() => switchSegment('separate')}>별도{separateRows.length > 0 ? ` ${separateRows.length}` : ''}</button>
          </div>
        </div>

        <div className="dm-chips" role="tablist" aria-label="터미널">
          <button className={`dm-chip ${terminal === null ? 'dm-chip-on' : ''}`} onClick={() => setTerminal(null)}>전체 {segmentRows.length}</button>
          {terminals.map((t) => (
            <button key={t.name} className={`dm-chip ${terminal === t.name ? 'dm-chip-on' : ''}`} onClick={() => setTerminal(terminal === t.name ? null : t.name)}>
              {t.name || '-'} {t.customers}{t.boxes > 0 ? ` · 박스 ${t.boxes}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="dm-sticky">
        <div className="dm-progress" role="status">
          <strong>완료 {counts.done}/{counts.all}</strong>
          <div className="dm-bar"><span style={{ width: `${pct}%` }} /></div>
          <span>상품 {totals.done}/{totals.live} · {pct}%</span>
        </div>
        <div className="dm-filters">
          <div className="dm-seg" role="tablist" aria-label="상태">
            {filters.map((f) => (
              <button key={f.key} role="tab" aria-selected={status === f.key} className={status === f.key ? 'dm-seg-on' : ''} onClick={() => setStatus(f.key)}>
                {f.label} <b>{f.count}</b>
              </button>
            ))}
          </div>
          <button className={`dm-view ${view === 'products' ? 'dm-view-on' : ''}`} onClick={() => setView(view === 'products' ? 'customers' : 'products')} aria-pressed={view === 'products'}>
            <ListChecks size={16} /> 품목별
          </button>
        </div>
      </div>

      {view === 'products' ? (
        <ul className="dm-products">
          {productRows.length === 0 && <li className="dm-empty">상품이 없습니다.</li>}
          {productRows.map((p) => (
            <li key={p.key}>
              <span className="dm-product-name">{p.label}</span>
              <span className="dm-product-qty">{p.total}{p.unit}</span>
              {p.unshipped > 0 && <span className="dm-tag dm-tag-amber">미출고 {p.unshipped}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <DndContext id="mobile-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((r) => r.dailyBusinessId)} strategy={verticalListSortingStrategy}>
        <ul className="dm-cards">
          {visible.length === 0 && (
            <li className="dm-empty">
              {status === 'pending' && counts.all > 0 ? '모든 고객이 완료되었습니다. 🎉' : '해당하는 고객이 없습니다.'}
              {status !== 'all' && counts.all > 0 && <button onClick={() => setStatus('all')}>전체 보기</button>}
            </li>
          )}
          {visible.map((row) => {
            const rowItems = itemsByRow.get(row.dailyBusinessId) ?? [];
            const s = statsByRow.get(row.dailyBusinessId)!;
            const done = isCardComplete(rowItems);
            const open = openIds.has(row.dailyBusinessId);
            const round = roundOf(row);
            const live = rowItems.filter(isLive);
            const summary = live.slice(0, 3).map((i) => `${i.productName} ${isUndecidedQuantity(i) ? '미정' : `${i.quantity}${i.unit}`}`).join(' · ') + (live.length > 3 ? ` 외 ${live.length - 3}건` : '');
            const badge = terminalBadgeProps(row.terminal, terminalColors);
            const stageKey = stageOf(row.totalBoxes, row.boxStates, done, row.parcel);
            const stage = { key: stageKey, visible: live.length > 0, detail: stageDetail(stageKey, { parcel: row.parcel, boxStates: row.boxStates, itemsDone: s.done, itemsLive: s.live }) };
            return (
              <SortableCard key={row.dailyBusinessId} id={row.dailyBusinessId} disabled={!canReorder} className={`dm-card ${done ? 'dm-card-done' : ''}`}>
                {(handle) => (
                <>
                <div className="dm-card-top">
                <span className="dm-no">{segmentRows.indexOf(row) + 1}</span>
                <button className="dm-card-head" onClick={() => toggleOpen(row.dailyBusinessId)} aria-expanded={open}>
                  <span className={`dm-term ${badge.className}`} style={badge.style}>{row.terminal || '-'}</span>
                  <span className="dm-name">
                    {done && <span className="dm-done"><Check size={12} strokeWidth={4} />완료</span>}
                    {round && <span className="dm-round">{roundLabel(round)}</span>}
                    {row.businessName}
                  </span>
                  <span className="dm-boxes">박스 {row.totalBoxes ?? '-'}</span>
                  <ChevronDown size={18} className={`dm-chev ${open ? 'dm-chev-open' : ''}`} />
                </button>
                {handle}
                </div>
                <div className="dm-meta">
                  <span className="dm-prog"><b>{s.done}</b>/{s.live}</span>
                  <div className="dm-bar dm-bar-sm"><span style={{ width: `${s.live ? (s.done / s.live) * 100 : 0}%` }} /></div>
                  {s.added > 0 && <span className="dm-tag dm-tag-green">신규 {s.added}</span>}
                  {s.modified > 0 && <span className="dm-tag dm-tag-amber">수정 {s.modified}</span>}
                  {s.unshipped > 0 && <span className="dm-tag dm-tag-amber">미출고 {s.unshipped}</span>}
                  {s.cancelled > 0 && <span className="dm-tag dm-tag-red">취소 {s.cancelled}</span>}
                  {s.undecided > 0 && <span className="dm-tag dm-tag-amber">수량 미정 {s.undecided}</span>}
                  {row.packingChanged && <span className="dm-tag dm-tag-red">박스 재확인</span>}
                </div>
                {stage.visible && (
                  <div className="dm-stage-row">
                    <span className={`dm-tag dm-stage dm-stage-${stage.key}`}>{STAGE_LABEL[stage.key]}</span>
                    <BoxDots states={row.boxStates} />
                    <span className="dm-stage-detail">{stage.detail}</span>
                  </div>
                )}
                {row.memo && <p className="dm-memo">메모: {row.memo}</p>}
                {!open && <p className="dm-summary">{summary || '상품 없음'}</p>}
                {open && (
                  <div className="dm-items">
                    {rowItems.map((item) => (
                      <button key={item.id} className={`dm-item ${isDone(item) && isLive(item) ? 'dm-item-done' : ''} dm-item-${item.changeStatus}`} onClick={() => setSheetItemId(item.id)}>
                        <span className={`dm-check ${item.isPacked ? 'dm-check-on' : ''}`} aria-label={item.isPacked ? '포장 완료' : '포장 전'}>{item.isPacked && <Check size={14} strokeWidth={4} />}</span>
                        <span className="dm-item-main">
                          <span className="dm-item-name">{item.productName}</span>
                          <span className="dm-item-detail">{detailOf(item)}</span>
                        </span>
                        <span className="dm-item-flags">
                          {item.changeStatus === 'new' && <span className="dm-tag dm-tag-green">신규</span>}
                          {item.changeStatus === 'modified' && <span className="dm-tag dm-tag-amber">수정</span>}
                          {item.changeStatus === 'cancelled' && <span className="dm-tag dm-tag-red">취소</span>}
                          {item.unshippedQuantity > 0 && item.changeStatus !== 'cancelled' && <span className="dm-tag dm-tag-amber">미출고 {item.unshippedQuantity}</span>}
                        </span>
                      </button>
                    ))}
                    {rowItems.length === 0 && <p className="dm-summary">상품이 없습니다.</p>}
                    {!readOnly && (
                      <div className="dm-card-actions">
                        <button onClick={() => props.onAddItem(row)}><Plus size={16} /> 상품 추가</button>
                        {canDelete && <button className="dm-danger" onClick={() => props.onDeleteOrder(row)}><Trash2 size={16} /> 주문 삭제</button>}
                      </div>
                    )}
                  </div>
                )}
                </>
                )}
              </SortableCard>
            );
          })}
        </ul>
        </SortableContext>
        </DndContext>
      )}

      {sheetItem && (
        <div className="dm-sheet-backdrop" onClick={() => setSheetItemId(null)}>
          <div className="dm-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="dm-sheet-head">
              <div>
                <strong>{sheetItem.productName}</strong>
                <span>{sheetRow?.businessName} · {detailOf(sheetItem)}</span>
              </div>
              <button className="dm-icon" onClick={() => setSheetItemId(null)} aria-label="닫기"><X size={20} /></button>
            </div>
            {readOnly ? (
              <p className="dm-sheet-note">조회 전용입니다. 수정하려면 PC에서 하거나 권한을 확인하세요.</p>
            ) : (
              <div className="dm-sheet-actions">
                {sheetItem.changeStatus !== 'cancelled' && (
                  <button className="dm-primary" onClick={() => { props.onTogglePacked(sheetItem); setSheetItemId(null); }}>
                    <Check size={18} /> {sheetItem.isPacked ? '포장 완료 해제' : '포장 완료로 표시'}
                  </button>
                )}
                <button onClick={() => { props.onEditItem(sheetItem); setSheetItemId(null); }}><Pencil size={18} /> 수량·내용 수정</button>
                {sheetItem.changeStatus !== 'cancelled' && (
                  <button onClick={() => { props.onUnshipped(sheetItem); setSheetItemId(null); }}><PackageX size={18} /> 미출고 처리</button>
                )}
                {canDelete && sheetItem.changeStatus !== 'cancelled' && (
                  <button className="dm-danger" onClick={() => { if (window.confirm(`'${sheetItem.productName}' 주문을 취소할까요? (주문 자체가 없어진 것으로 표시됩니다)`)) { props.onCancelItem(sheetItem); setSheetItemId(null); } }}>
                    <Ban size={18} /> 주문 취소
                  </button>
                )}
                {canDelete && (
                  <button className="dm-danger" onClick={() => { props.onDeleteItem(sheetItem); setSheetItemId(null); }}><Trash2 size={18} /> 상품 삭제</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .dm-root { display: flex; flex-direction: column; gap: 0.6rem; padding-bottom: 1rem; }
        .dm-head { display: flex; flex-direction: column; gap: 0.4rem; }
        .dm-sticky { position: sticky; top: 0; z-index: 20; background: var(--background, #f8fafc); padding: 0.25rem 0.25rem 0.35rem; margin: 0 -0.25rem; display: flex; flex-direction: column; gap: 0.35rem; }
        .dm-date { display: flex; align-items: center; gap: 0.4rem; }
        .dm-date-nav { display: flex; align-items: center; gap: 0.3rem; flex: 1; min-width: 0; }
        .dm-toggle { flex: none; display: flex; background: #e2e8f0; border-radius: 12px; padding: 3px; gap: 2px; height: var(--ctl-h); }
        .dm-toggle button { border: 0; background: transparent; border-radius: 9px; padding: 0 0.55rem; font-size: 0.75rem; font-weight: 800; color: #475569; white-space: nowrap; }
        .dm-toggle .dm-toggle-on { background: #fff; color: #003057; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.15); }
        .dm-add { flex: none; width: var(--ctl-h); height: var(--ctl-h); border-radius: 12px; border: 0; background: #003057; color: #fff; display: grid; place-items: center; }
        .dm-add:active { opacity: 0.85; }
        .dm-icon { width: var(--ctl-h); height: var(--ctl-h); border-radius: 12px; border: 1px solid var(--border); background: #fff; display: grid; place-items: center; flex: none; }
        .dm-icon:disabled { opacity: 0.4; }
        .dm-date-label { position: relative; flex: 1; min-width: 0; padding: 0 0.4rem; height: var(--ctl-h); border-radius: 12px; border: 1px solid var(--border); background: #fff; display: grid; place-items: center; font-size: 0.9375rem; font-weight: 800; }
        .dm-date-label input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; font-size: 16px; }
        .dm-today { height: var(--ctl-h); padding: 0 0.8rem; border-radius: 12px; border: 0; background: #003057; color: #fff; font-weight: 800; font-size: 0.8125rem; flex: none; }
        .dm-progress { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 0 0.7rem; height: var(--ctl-h); display: flex; align-items: center; gap: 0.6rem; }
        .dm-progress strong { font-size: 0.875rem; font-weight: 900; white-space: nowrap; }
        .dm-progress span { font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; white-space: nowrap; }
        .dm-bar { flex: 1; min-width: 2rem; height: 7px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
        .dm-bar span { display: block; height: 100%; background: #22c55e; border-radius: 999px; }
        .dm-bar-sm { height: 6px; flex: 1; min-width: 3rem; }
        .dm-chips { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
        .dm-chips::-webkit-scrollbar { display: none; }
        .dm-chip { flex: none; height: var(--chip-h); padding: 0 0.75rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.8125rem; font-weight: 700; white-space: nowrap; }
        .dm-chip-on { background: #003057; border-color: #003057; color: #fff; }
        .dm-filters { display: flex; gap: 0.5rem; align-items: center; }
        .dm-seg { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; background: #e2e8f0; border-radius: 12px; padding: 3px; gap: 2px; height: var(--ctl-h); }
        .dm-view { flex: none; height: var(--ctl-h); padding: 0 0.7rem; border-radius: 12px; border: 1px solid var(--border); background: #fff; font-size: 0.75rem; font-weight: 800; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; }
        .dm-view-on { background: #003057; border-color: #003057; color: #fff; }
        .dm-seg button { height: calc(var(--ctl-h) - 6px); border: 0; background: transparent; border-radius: 10px; font-size: 0.75rem; font-weight: 700; color: #475569; padding: 0 0.3rem; white-space: nowrap; }
        .dm-seg button b { font-weight: 900; margin-left: 0.1rem; }
        .dm-seg .dm-seg-on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.15); }
        .dm-cards, .dm-products { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
        .dm-empty { text-align: center; color: var(--muted-foreground); padding: 2rem 1rem; font-weight: 700; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; }
        .dm-empty button { min-height: 44px; padding: 0 1.2rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-weight: 800; }
        .dm-card { background: #fff; border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
        .dm-card-done { background: #f0fdf4; border-color: #86efac; }
        .dm-card-top { display: flex; align-items: center; }
        .dm-no { flex: none; min-width: 1.9rem; padding-left: 0.6rem; font-size: 0.75rem; font-weight: 800; color: #94a3b8; font-variant-numeric: tabular-nums; }
        .dm-grip { flex: none; width: 40px; height: 40px; margin-right: 0.15rem; display: grid; place-items: center; background: none; border: 0; color: #94a3b8; touch-action: none; cursor: grab; border-radius: 10px; }
        .dm-grip:active { background: #f1f5f9; color: #475569; }
        .dm-dragging { position: relative; z-index: 30; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.28); opacity: 0.95; }
        .dm-card-head { width: 100%; display: flex; align-items: center; gap: 0.45rem; padding: 0.55rem 0.7rem 0.25rem; background: none; border: 0; text-align: left; min-height: 44px; }
        .dm-term { flex: none; white-space: nowrap; padding: 0.1rem 0.45rem; border-radius: 7px; border: 1px solid; font-size: 0.6875rem; font-weight: 800; }
        .dm-name { flex: 1; min-width: 0; font-size: 0.9375rem; font-weight: 800; line-height: 1.25; word-break: keep-all; }
        .dm-done { display: inline-flex; align-items: center; gap: 2px; margin-right: 0.3rem; padding: 0 0.35rem; border-radius: 6px; border: 1px solid #34d399; background: #d1fae5; color: #065f46; font-size: 0.6875rem; font-weight: 800; vertical-align: 2px; }
        .dm-round { margin-right: 0.3rem; padding: 0 0.35rem; border-radius: 6px; border: 1px solid #c4b5fd; background: #f5f3ff; color: #6d28d9; font-size: 0.6875rem; font-weight: 800; vertical-align: 2px; }
        .dm-boxes { flex: none; font-size: 0.75rem; font-weight: 700; color: #64748b; white-space: nowrap; }
        .dm-chev { flex: none; color: #94a3b8; transition: transform 0.15s; }
        .dm-chev-open { transform: rotate(180deg); }
        .dm-meta { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; padding: 0 0.7rem 0.25rem; }
        .dm-prog { font-size: 0.8125rem; font-weight: 700; color: #475569; }
        .dm-prog b { font-weight: 900; color: #0f172a; }
        .dm-tag { font-size: 0.6875rem; font-weight: 800; border-radius: 6px; padding: 0.05rem 0.35rem; border: 1px solid; white-space: nowrap; }
        .dm-tag-green { background: #ecfdf5; border-color: #6ee7b7; color: #047857; }
        .dm-tag-amber { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
        .dm-stage-row { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; min-width: 0; font-size: 0.75rem; line-height: 1.5; }
        .dm-stage-detail { color: var(--muted-foreground); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .dm-stage { font-weight: 800; flex: none; }
        .dm-stage-boxing { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
        .dm-stage-labeling { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
        .dm-stage-packing { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
        .dm-stage-packed { background: #f0fdfa; border-color: #5eead4; color: #0f766e; }
        .dm-stage-loading { background: #f0f9ff; border-color: #7dd3fc; color: #0369a1; }
        .dm-stage-done { background: #ecfdf5; border-color: #6ee7b7; color: #047857; }
        .dm-tag-red { background: #fff1f2; border-color: #fda4af; color: #be123c; }
        .dm-memo { margin: 0; padding: 0 0.7rem 0.25rem; font-size: 0.75rem; font-weight: 700; color: #92400e; }
        .dm-summary { margin: 0; padding: 0 0.7rem 0.6rem; font-size: 0.8125rem; color: #334155; line-height: 1.4; }
        .dm-items { border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; }
        .dm-item { display: flex; align-items: center; gap: 0.55rem; padding: 0.3rem 0.7rem; min-height: 42px; background: none; border: 0; border-bottom: 1px solid #f1f5f9; text-align: left; width: 100%; }
        .dm-item-done .dm-item-name, .dm-item-done .dm-item-detail { color: #94a3b8; }
        .dm-item-cancelled .dm-item-name { text-decoration: line-through; color: #be123c; }
        .dm-check { flex: none; width: 24px; height: 24px; border-radius: 999px; border: 2px solid #cbd5e1; display: grid; place-items: center; color: #fff; background: #fff; }
        .dm-check-on { background: #22c55e; border-color: #22c55e; }
        .dm-item-main { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
        .dm-item-name { font-size: 0.875rem; font-weight: 800; line-height: 1.25; min-width: 0; }
        .dm-item-detail { font-size: 0.8125rem; font-weight: 700; color: #0369a1; text-align: right; flex: none; max-width: 55%; }
        .dm-item-flags { display: flex; flex-direction: column; gap: 0.2rem; align-items: flex-end; flex: none; }
        .dm-card-actions { display: flex; gap: 0.5rem; padding: 0.5rem 0.7rem 0.65rem; font-size: 0.8125rem; }
        .dm-card-actions button { flex: 1; min-height: 44px; border-radius: 12px; border: 1px dashed #94a3b8; background: #fff; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; }
        .dm-card-actions .dm-danger { border-style: solid; border-color: #fecdd3; color: #be123c; flex: none; padding: 0 1rem; }
        .dm-products li { display: flex; align-items: center; gap: 0.5rem; background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 0.5rem 0.75rem; min-height: 44px; }
        .dm-product-name { flex: 1; min-width: 0; font-weight: 700; font-size: 0.875rem; word-break: keep-all; }
        .dm-product-qty { font-size: 0.9375rem; font-weight: 900; }
        .dm-sheet-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-end; }
        .dm-sheet { width: 100%; background: #fff; border-radius: 20px 20px 0 0; padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 0.8rem; box-shadow: 0 -8px 30px rgba(15, 23, 42, 0.25); }
        .dm-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
        .dm-sheet-head div { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
        .dm-sheet-head strong { font-size: 1.0625rem; font-weight: 900; }
        .dm-sheet-head span { font-size: 0.8125rem; color: #475569; font-weight: 700; }
        .dm-sheet-actions { display: flex; flex-direction: column; gap: 0.5rem; }
        .dm-sheet-actions button { min-height: 48px; border-radius: 12px; border: 1px solid var(--border); background: #fff; font-size: 0.9375rem; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        .dm-sheet-actions .dm-primary { background: #22c55e; border-color: #22c55e; color: #fff; }
        .dm-sheet-actions .dm-danger { color: #be123c; border-color: #fecdd3; }
        .dm-sheet-note { margin: 0; color: #64748b; font-weight: 700; }
      `}</style>
    </div>
  );
}
