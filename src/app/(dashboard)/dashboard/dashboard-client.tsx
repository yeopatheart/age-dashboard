'use client';
import { useState, useRef, useEffect, useLayoutEffect, useOptimistic, useSyncExternalStore, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Check, GripVertical, Plus, Pencil, Trash2, X, Inbox, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Highlighter, LayoutGrid, Monitor, PackageX, Truck } from 'lucide-react';
import { businessIdsInBothRounds, roundLabel, getProductSummary, getTerminalBoxTotals, isCardComplete, isUndecidedQuantity, type OrderItem, type OrderRow, type ProductSummaryRow, type ChangeStatus, type OrderRound } from '@/lib/orders';
import { terminalBadgeProps, terminalDotProps, type TerminalColorMap } from '@/lib/terminal-color';
import { resolveColors } from '@/lib/color-palette';
import { useCan } from '@/components/permissions-context';
import {
  setProductHighlight,
  clearProductHighlights,
  togglePacked,
  reorderDailyBusinesses,
  createManualOrder,
  updateOrder,
  deleteDailyBusiness,
  addOrderItemManual,
  updateOrderItemManual,
  cancelOrderItem,
  setItemUnshipped,
  deleteOrderItem,
  type ManualItemFields,
} from './actions';

// 행 높이는 고정값이 아니라 단계(큰 것부터)에서 고른다 — 모니터 2대에 주문이 전부 들어가는
// 가장 큰 높이를 쓰므로, 주문이 적으면 시원하게(40px), 최대 60건까지 늘면 30px까지 줄어든다.
// 전체보기·모니터 1·2가 항상 같은 높이를 쓴다. 30px 미만은 가독성 때문에 내려가지 않는다.
const ROW_HEIGHT_TIERS = [40, 36, 32, 30];
const MIN_ROW_HEIGHT = ROW_HEIGHT_TIERS[ROW_HEIGHT_TIERS.length - 1];
const MONITOR_COUNT = 2;
const INITIAL_ROW_CAPACITY = 30; // 측정 전(첫 렌더) 임시값

// 헤더와 각 본문 행이 전부 독립된 flexbox였을 때는 같은 칸이라도 행마다 내용에 따라 폭이
// 1~2px씩 미묘하게 달라져(브라우저의 flex 여유공간 분배가 셀 내용에 영향받는 경우가 있다)
// 여러 줄에 걸쳐 누적되면 열 경계가 눈에 띄게 어긋났다. 헤더·모든 행이 똑같은 grid-template-
// columns 값을 공유하는 CSS Grid로 바꿔서, 같은 칸은 항상 같은 폭이 되도록 강제한다.
// 품목별 수량 세로 패널. 모니터 2 오른쪽과 별도 주문 팝업 오른쪽에서 같이 쓴다.
// 칩 크기는 고정하지 않고 글자 길이에 맞춘다: 품목명 한글 오름차순 순서 그대로 한 줄에 들어가는 만큼 채우고(flex-wrap),
// 남는 폭은 그 줄의 칩이 나눠 가진다. 긴 이름은 자연히 한 줄 전체를 쓰고, 이름을 말줄임(...)으로 자르지 않는다.
// availHeight를 주면(모니터 2) 품목이 늘어도 스크롤이 생기지 않게, 넘칠 때만 칩 높이·글자를 한 단계씩 줄인다.
// 안 주면(팝업) 기본 크기로 그리고 넘치면 패널 안에서 스크롤한다.
const SUMMARY_ITEM_HEIGHTS = [26, 24, 22, 20, 18, 16, 14];
function ProductSummaryPanel({
  columns,
  chipStyle,
  availHeight,
}: {
  columns: ProductSummaryRow[];
  chipStyle: (name: string) => React.CSSProperties;
  availHeight?: number;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const signature = `${columns.map((c) => `${c.key}:${c.total}:${c.unshipped}`).join('|')}@${availHeight ?? ''}`;
  // 품목·수량·높이가 바뀌면 가장 큰 크기부터 다시 시도한다.
  const [fit, setFit] = useState<{ signature: string; level: number }>({ signature: '', level: 0 });
  const level = availHeight === undefined ? 0 : fit.signature === signature ? fit.level : 0;
  useLayoutEffect(() => {
    if (availHeight === undefined) return;
    const check = () => {
      const grid = gridRef.current;
      if (!grid) return;
      if (grid.scrollHeight > grid.clientHeight + 1 && level < SUMMARY_ITEM_HEIGHTS.length - 1) setFit({ signature, level: level + 1 });
    };
    check();
    // 웹폰트가 늦게 로드되면 글자 폭이 달라지므로 로드 후 한 번 더 확인한다.
    void document.fonts?.ready.then(check);
  }, [signature, level, availHeight]);
  const itemHeight = SUMMARY_ITEM_HEIGHTS[level];
  return (
    <aside className="w-64 flex-shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ borderTop: '3px solid #003057' }}>
      <div className="px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50 border-b border-slate-100 flex-shrink-0">품목별 수량</div>
      <div ref={gridRef} className={`flex-1 min-h-0 flex flex-wrap content-start gap-x-1 p-1.5 ${availHeight === undefined ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        {columns.map((product) => (
          <div
            key={product.key}
            className="flex items-center justify-between gap-1 px-1.5 rounded border mb-px"
            style={{ ...chipStyle(product.productName), minHeight: itemHeight - 1, fontSize: Math.min(12, itemHeight - 6), flex: '1 1 auto', maxWidth: '100%' }}
          >
            <span className="font-bold break-keep leading-tight">{product.label}</span>
            <span className="font-black shrink-0 whitespace-nowrap leading-tight">
              {product.total}{product.unit}
              {product.unshipped > 0 && <span className="ml-1 text-amber-700">(미출고 {product.unshipped})</span>}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// 같은 고객사가 1차·2차에 모두 있을 때만 업체명 앞에 붙는 작은 배지 — 행 높이를 키우지 않도록 업체명 줄 안에 인라인으로 흐른다.
function RoundBadge({ round }: { round: OrderRound }) {
  return (
    <span className={`inline-block align-middle mr-1 px-1 rounded border text-[10px] font-bold leading-[14px] ${round === 1 ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>
      {roundLabel(round)}
    </span>
  );
}

// 업체의 모든 상품이 끝났을 때 업체명 앞에 붙는 표시 — 업체명 줄 안에 인라인으로 흐르므로 행 높이를 키우지 않는다.
function DoneBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle mr-1 px-1 rounded border border-emerald-400 bg-emerald-100 text-emerald-800 text-[10px] font-extrabold leading-[14px]" title="이 업체의 모든 상품이 완료되었습니다">
      <Check className="w-2.5 h-2.5" strokeWidth={4} />완료
    </span>
  );
}

// 드래그로 순서를 바꾸는 표 행. 행 전체가 아니라 "번호" 칸의 손잡이로만 끌 수 있다 — 행 안의 상품 칩은 클릭(수정·포장)이 주 동작이라 충돌한다.
function SortableRow({
  id,
  disabled,
  className,
  style,
  children,
}: {
  id: string;
  disabled: boolean;
  className: string;
  style: React.CSSProperties;
  children: (handle: { ref: (el: HTMLElement | null) => void; props: Record<string, unknown> } | null) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isDragging ? 'relative z-10 bg-white shadow-lg opacity-90' : ''}`}
      // 세로 이동만 허용한다(modifiers 패키지 없이 x를 버린다).
      style={{ ...style, transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
    >
      {children(disabled ? null : { ref: setActivatorNodeRef, props: { ...attributes, ...listeners } })}
    </div>
  );
}

// flexible = 모니터 1/2: 열을 화면 폭에 맞춰 줄여서 가로 스크롤이 생기지 않게 한다(스크롤 밖의 상품을 놓치지 않도록).
// 마지막 칸은 "+" 추가 버튼 자리라 좁게 고정하고, 나머지 폭을 상품 칸이 나눠 쓴다.
// 전체보기는 열마다 최소 폭을 두고 필요하면 옆으로 스크롤한다.
const ADD_COLUMN_WIDTH = 36;
// 고객명 열은 이 날짜 고객명 중 가장 긴 것에 맞춘다(모니터 1·2가 같은 폭을 쓰도록 표시 중인 줄이 아니라 전체 줄 기준).
// 수정/삭제 버튼은 이름 위에 겹쳐 나타나므로 버튼 자리를 따로 잡지 않는다.
const NAME_COLUMN_DEFAULT = 144;
const NAME_COLUMN_MIN = 72;
const NAME_COLUMN_MAX = 220;
const ROUND_BADGE_WIDTH = 28; // RoundBadge("1차") 폭 + 오른쪽 간격
function productGridTemplate(slotCount: number, flexible = false, nameColumn = NAME_COLUMN_DEFAULT) {
  const fixed = `40px 80px ${nameColumn}px 56px`;
  if (!flexible) return `${fixed} repeat(${slotCount}, minmax(130px, 1fr))`;
  const productColumns = slotCount - 1;
  return `${fixed} ${productColumns > 0 ? `repeat(${productColumns}, minmax(0, 1fr)) ` : ''}${ADD_COLUMN_WIDTH}px`;
}
// 위 열 정의의 최소 폭 합. 표 전체 폭을 이 값 이상으로 잡아야 옆으로 스크롤해도 헤더·행 배경이 끝까지 이어진다.
const productGridFixedWidth = (nameColumn: number) => 40 + 80 + nameColumn + 56;
function productGridMinWidth(slotCount: number, nameColumn: number) {
  return productGridFixedWidth(nameColumn) + slotCount * 130;
}

// 전체보기 위쪽 "품목별 수량" 카드를 접은 상태. 이 브라우저(PC·TV)마다 따로 기억한다 — 서버에는 저장하지 않는다.
const SUMMARY_COLLAPSED_KEY = 'dash-summary-collapsed';
const summaryListeners = new Set<() => void>();
function useSummaryCollapsed(): [boolean, (next: boolean) => void] {
  const collapsed = useSyncExternalStore(
    (cb) => {
      summaryListeners.add(cb);
      window.addEventListener('storage', cb);
      return () => {
        summaryListeners.delete(cb);
        window.removeEventListener('storage', cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(SUMMARY_COLLAPSED_KEY) === '1';
      } catch {
        return false;
      }
    },
    () => false,
  );
  const set = (next: boolean) => {
    try {
      localStorage.setItem(SUMMARY_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // localStorage가 막혀 있으면 저장 없이 이번 화면에서만 바뀐다
    }
    summaryListeners.forEach((l) => l());
  };
  return [collapsed, set];
}

// 오늘 강조한 상품의 상품명 글자색. 첫 번째는 빨강이고, 두 개 이상 고르면 고른 순서대로 서로 다른 색을 쓴다.
// 상태 색(신규 초록, 수정 노랑, 취소 빨강)과 헷갈리지 않게 파랑·보라·분홍·청록·갈색 계열로 이어 간다.
const HIGHLIGHT_COLORS = ['#dc2626', '#2563eb', '#9333ea', '#db2777', '#0e7490', '#a16207'];

function getItemStyle(status: ChangeStatus, isPacked: boolean, unshipped = 0, quantity = 0) {
  // 미출고(주문은 유효하지만 출고하지 못함)는 취소와 구분되도록 취소선 없이 호박색 점선으로 표시한다.
  // 전량 미출고면 배경도 진하게, 일부만이면 연하게. 취소된 상품은 취소 표시가 우선한다.
  if (unshipped > 0 && status !== 'cancelled') {
    return unshipped >= quantity
      ? { bg: 'bg-amber-100', border: 'border-amber-500 border-dashed', text: 'text-amber-900' }
      : { bg: 'bg-amber-50', border: 'border-amber-500 border-dashed', text: 'text-slate-900' };
  }
  if (isPacked && status !== 'cancelled') {
    return { bg: 'bg-slate-100', border: 'border-slate-300', text: 'text-slate-400' };
  }
  switch (status) {
    case 'new':       return { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700' };
    case 'modified':  return { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-700' };
    case 'cancelled': return { bg: 'bg-rose-50',    border: 'border-rose-300',    text: 'text-rose-600 line-through' };
    // 최초주문(변경 없음) — 빈 칸(+ 점선 박스)과 뚜렷이 구분되도록 진한 테두리+검은 글씨로 표시한다.
    default:          return { bg: 'bg-slate-50',   border: 'border-slate-800',   text: 'text-slate-900' };
  }
}

const STATUS_LABEL: Record<ChangeStatus, string> = {
  none: '최초주문',
  new: '추가됨 (초록)',
  modified: '수정됨 (노랑)',
  cancelled: '취소/삭제 (빨강)',
};

// ─── Modal wrapper (Figma Dashboard.tsx 포팅) ──────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ backgroundColor: '#003057' }}>
          <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── 새 주문 추가/수정 모달 ─────────────────────────────────────────────────────
interface Terminal { id: string; name: string; fill_color: string | null; border_color: string | null; is_separate?: boolean }
interface BusinessDirectoryEntry { id: string; name: string; terminal_id: string | null }

// ─── 미출고 처리 모달 ──────────────────────────────────────────────────────────
// 미출고 = 주문은 유효하지만 현장에서 출고하지 못한 수량(주문취소와 별개). 수량 0이면 해제.
function UnshippedModal({
  item,
  reasons,
  onSave,
  onClose,
}: {
  item: OrderItem;
  reasons: string[];
  onSave: (quantity: number, reason: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const initialReason = item.unshippedReason ?? '';
  const [qty, setQty] = useState(String(item.unshippedQuantity > 0 ? item.unshippedQuantity : item.quantity));
  const [reasonChoice, setReasonChoice] = useState(reasons.includes(initialReason) ? initialReason : initialReason ? '기타' : '');
  const [otherReason, setOtherReason] = useState(reasons.includes(initialReason) ? '' : initialReason);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (quantity: number) => {
    setBusy(true);
    const reason = reasonChoice === '기타' ? otherReason.trim() || null : reasonChoice || null;
    const err = await onSave(quantity, reason);
    setBusy(false);
    if (err) setError(err);
  };
  const parsed = parseFloat(qty);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= item.quantity + 0.0001;

  return (
    <Modal title="미출고 처리" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-800">{item.businessName}</strong> · {item.productName} 주문 {item.quantity}{item.unit}
          <span className="block text-xs text-slate-400 mt-1">주문은 그대로 유효하고, 출고하지 못한 수량만 기록합니다. 주문 자체를 없애려면 취소를 사용하세요.</span>
        </p>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">미출고 수량 ({item.unit})</label>
          <input
            type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
            className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
          />
          <button type="button" className="ml-2 text-xs font-bold text-sky-600" onClick={() => setQty(String(item.quantity))}>전체({item.quantity})</button>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">사유 (선택)</label>
          <div className="flex flex-wrap gap-1.5">
            {[...reasons, '기타'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReasonChoice(reasonChoice === r ? '' : r)}
                className={`px-3 py-1 rounded-full border text-xs font-bold transition-colors ${reasonChoice === r ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >{r}</button>
            ))}
          </div>
          {reasonChoice === '기타' && (
            <input
              value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="사유 직접 입력"
              className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
            />
          )}
        </div>
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          {item.unshippedQuantity > 0 && (
            <button type="button" disabled={busy} onClick={() => submit(0)} className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50">미출고 해제</button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50">닫기</button>
          <button
            type="button" disabled={busy || !valid} onClick={() => submit(parsed)}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: '#003057' }}
          >저장</button>
        </div>
      </div>
    </Modal>
  );
}

const SUGGESTION_ROW_HEIGHT = 36;
const SUGGESTION_VISIBLE_ROWS = 5;

function OrderFormModal({
  initial,
  terminals,
  businesses,
  registered = [],
  onSave,
  onClose,
}: {
  initial?: { businessName: string; terminalId: string | null };
  terminals: Terminal[];
  businesses: BusinessDirectoryEntry[];
  // 이 날짜 대시보드에 이미 올라와 있는 (업체, 차수, 터미널) — 새 주문 추가에서 같은 차수·터미널의 중복 등록을 막는다.
  registered?: { businessId: string; round: OrderRound; terminal: string }[];
  // 저장에 실패하면 화면에 보여줄 오류 문구를 돌려준다(성공하면 null).
  onSave: (data: { businessName: string; terminalId: string | null; round: OrderRound }) => Promise<string | null>;
  onClose: () => void;
}) {
  const isEdit = Boolean(initial);
  const modalColors: TerminalColorMap = Object.fromEntries(terminals.map((t) => [t.name, { fill: t.fill_color, border: t.border_color }]));
  const [businessName, setBusinessName] = useState(initial?.businessName ?? '');
  const [terminalId, setTerminalId] = useState(initial?.terminalId ?? terminals[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [round, setRound] = useState<OrderRound>(1);

  // 새 주문 추가는 고객명을 직접 타이핑해서 확정하지 않는다 — 키워드로 고객사 관리의 등록 목록을
  // 검색해 고르게 해서 오타를 막고, 터미널은 그 고객에 등록된 매핑을 그대로 쓴다(주문 확정은 현장
  // 배송과 직결되어 사고 비용이 크다). 새 고객은 고객사 관리나 주문 입력에서 등록한다.
  const matchedBusiness = !isEdit ? businesses.find((b) => b.id === selectedId) : undefined;
  const keyword = businessName.trim().toLowerCase();
  const suggestions =
    !isEdit && !matchedBusiness && keyword
      ? businesses.filter((b) => b.name.toLowerCase().includes(keyword))
      : [];
  const selectBusiness = (b: BusinessDirectoryEntry) => {
    setSelectedId(b.id);
    setDuplicateError(false);
    setBusinessName(b.name);
  };
  const matchedTerminal = matchedBusiness?.terminal_id
    ? terminals.find((t) => t.id === matchedBusiness.terminal_id) ?? null
    : null;

  const handleSave = async () => {
    if (!businessName.trim() || (!isEdit && !matchedBusiness)) return;
    if (matchedBusiness && registered.some((r) => r.businessId === matchedBusiness.id && r.round === round && r.terminal === (matchedTerminal?.name ?? ''))) {
      setDuplicateError(true);
      return;
    }
    const resolvedTerminalId = isEdit ? (terminalId || null) : (matchedTerminal?.id ?? null);
    setSaveError(null);
    const error = await onSave({ businessName: (matchedBusiness?.name ?? businessName).trim(), terminalId: resolvedTerminalId, round });
    if (error) setSaveError(error);
  };

  return (
    <Modal title={isEdit ? '주문 수정' : '새 주문 추가'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">고객명 *</label>
          <input
            value={businessName}
            onChange={(e) => {
              setBusinessName(e.target.value);
              setSelectedId(null);
              setDuplicateError(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              if (!isEdit && !matchedBusiness) {
                if (suggestions.length === 1) selectBusiness(suggestions[0]);
                return;
              }
              handleSave();
            }}
            placeholder={isEdit ? '고객명' : '고객명 검색 (예: 스시)'}
            autoFocus
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:ring-1 focus:ring-[#003057] focus:outline-none"
          />
          {/* 검색 결과는 입력창 아래에 겹쳐 뜨는 드롭다운이다 — 팝업의 다른 항목 배치는 그대로 두고, 5줄까지만 보이고 넘으면 안에서 스크롤한다. */}
          {!isEdit && (
            <div className="relative">
              {suggestions.length > 0 && (
                <ul
                  className="absolute left-0 right-0 top-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg overflow-y-auto"
                  style={{ maxHeight: SUGGESTION_ROW_HEIGHT * SUGGESTION_VISIBLE_ROWS + 2 }}
                >
                  {suggestions.map((b) => {
                    const terminalName = terminals.find((t) => t.id === b.terminal_id)?.name;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => selectBusiness(b)}
                          style={{ height: SUGGESTION_ROW_HEIGHT }}
                          className="w-full flex items-center gap-2 px-3 text-sm text-left hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                        >
                          <span className="font-semibold text-slate-700">{b.name}</span>
                          <span className="ml-auto text-[11px] text-slate-400">{terminalName ?? '터미널 미지정'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {keyword && !matchedBusiness && suggestions.length === 0 && (
                <p className="absolute left-0 right-0 top-1 z-20 bg-white border border-amber-200 rounded-lg shadow-lg px-3 py-2 text-xs text-amber-600">일치하는 고객이 없습니다. 고객사 관리에서 먼저 등록하거나 주문 입력으로 추가해주세요.</p>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">터미널</label>
          {isEdit ? (
            terminals.length === 0 ? (
              <p className="text-xs text-rose-500">등록된 터미널이 없습니다. 터미널 관리 화면에서 먼저 추가해주세요.</p>
            ) : (
              <div className="relative">
                <span
                  className={`absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${terminalDotProps(terminals.find((t) => t.id === terminalId)?.name ?? '', modalColors).className}`}
                  style={terminalDotProps(terminals.find((t) => t.id === terminalId)?.name ?? '', modalColors).style}
                />
                <select
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  className="w-full appearance-none border border-slate-300 rounded-lg pl-7 pr-9 py-2 text-sm focus:border-[#003057] focus:outline-none"
                >
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            )
          ) : !matchedBusiness ? (
            <p className="text-xs text-slate-400 py-2">고객을 선택하면 등록된 터미널이 자동으로 표시됩니다.</p>
          ) : matchedTerminal ? (
            <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
              <span className={`w-2 h-2 rounded-full ${terminalDotProps(matchedTerminal.name, modalColors).className}`} style={terminalDotProps(matchedTerminal.name, modalColors).style} />
              <span className="text-sm font-semibold text-slate-700">{matchedTerminal.name}</span>
              <span className="text-[11px] text-slate-400 ml-auto">자동 매핑</span>
            </div>
          ) : (
            <p className="text-xs text-amber-600 py-2">
              이 업체는 터미널이 지정되어 있지 않습니다. 고객사 관리에서 먼저 지정해주세요.
            </p>
          )}
        </div>
        {!isEdit && (
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">차수</label>
            <div className="inline-flex p-0.5 rounded-lg border border-slate-300">
              {([1, 2] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={round === r}
                  onClick={() => { setRound(r); setDuplicateError(false); }}
                  className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${round === r ? 'bg-[#003057] text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  {r}차
                </button>
              ))}
            </div>
          </div>
        )}
        {duplicateError && matchedBusiness && (
          <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            &apos;{matchedBusiness.name}&apos;은(는) 이미 대시보드에 {round}차로 등록된 고객입니다. 상품은 해당 행의 + 버튼으로 추가해주세요.
          </p>
        )}
        {saveError && (
          <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{saveError}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">취소</button>
          <button onClick={handleSave} disabled={!isEdit && !matchedBusiness} className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-40" style={{ backgroundColor: '#003057' }}>저장</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── 상품 추가/수정 모달 ────────────────────────────────────────────────────────
function ItemFormModal({
  mode,
  initial,
  onSave,
  onClose,
}: {
  mode: 'add' | 'edit';
  initial?: Partial<ManualItemFields>;
  onSave: (fields: ManualItemFields) => void;
  onClose: () => void;
}) {
  const [productName, setProductName] = useState(initial?.productName ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity?.toString() ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [weightKg, setWeightKg] = useState(initial?.secondaryWeightKg?.toString() ?? '');
  const [sizeRequest, setSizeRequest] = useState(initial?.sizeRequest ?? '');
  const [status, setStatus] = useState<ChangeStatus>(initial?.changeStatus ?? 'new');

  const handleSave = () => {
    if (!productName.trim() || !quantity.trim() || !unit.trim()) return;
    onSave({
      productName: productName.trim(),
      quantity: parseFloat(quantity),
      unit: unit.trim(),
      secondaryWeightKg: weightKg.trim() ? parseFloat(weightKg) : null,
      sizeRequest: sizeRequest.trim() || null,
      changeStatus: status,
    });
  };

  return (
    <Modal title={mode === 'edit' ? '상품 수정' : '상품 추가'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">상품명 *</label>
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="예) 참돔"
            autoFocus
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-600 mb-1">수량 *</label>
            <input
              type="number" min="0" step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="예) 3"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-bold text-slate-600 mb-1">단위 *</label>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="미/kg"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">
            중량 <span className="text-slate-400 font-normal">(kg, 선택)</span>
          </label>
          <input
            type="number" min="0" step="any"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="예) 2.5"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">상태</label>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ChangeStatus)}
              className="w-full appearance-none border border-slate-300 rounded-lg px-3 pr-9 py-2 text-sm focus:border-[#003057] focus:outline-none"
            >
              {(Object.entries(STATUS_LABEL) as [ChangeStatus, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">
            메모 <span className="text-slate-400 font-normal">(선택)</span>
          </label>
          <input
            value={sizeRequest}
            onChange={(e) => setSizeRequest(e.target.value)}
            placeholder="예) 500g → 400g으로 변경"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">취소</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors" style={{ backgroundColor: '#003057' }}>저장</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── 삭제 확인 모달 ────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title="삭제 확인" onClose={onClose}>
      <p className="text-sm text-slate-700 mb-6">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">취소</button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className="px-4 py-2 rounded-lg bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 transition-colors"
        >
          삭제
        </button>
      </div>
    </Modal>
  );
}

// ─── 메인 대시보드 ──────────────────────────────────────────────────────────────
export function DashboardClient({
  rows: rawRows,
  items,
  allTerminals,
  businessDirectory,
  orderDate,
  today,
  productColors,
  unshippedReasons,
  allowPast,
  highlights,
}: {
  rows: OrderRow[];
  items: OrderItem[];
  allTerminals: Terminal[];
  businessDirectory: BusinessDirectoryEntry[];
  orderDate: string;
  today: string;
  productColors: Record<string, { fill: string | null; border: string | null }>;
  unshippedReasons: string[];
  allowPast: boolean;
  highlights: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monitorMode = searchParams.get('monitor') || '1';

  // 과거 날짜는 기본적으로 조회 전용 — 실수로 지난 기록을 고치지 않게 편집 수단을 숨긴다.
  // 설정에서 "과거 날짜 편집"을 켜면 오늘과 똑같이 편집할 수 있다.
  const isPast = orderDate !== today;
  // 수정 권한이 없는 계정도 조회 전용이다. 삭제·취소는 별도 권한(dashboard:delete)이다.
  const can = useCan();
  const canDelete = can('dashboard:delete');
  const readOnly = (isPast && !allowPast) || !can('dashboard:edit');

  const dashboardUrl = (mode: string, date: string) =>
    `/dashboard?monitor=${mode}${date === today ? '' : `&date=${date}`}`;
  // 모니터 전환은 데이터가 그대로이고 배치만 바뀌므로 서버에 다시 요청하지 않는다 — 주소만 바꾸면
  // useSearchParams가 즉시 따라온다(날짜 변경은 다른 데이터라 router.push로 서버에서 다시 조회).
  const setMonitorMode = (mode: string) => window.history.pushState(null, '', dashboardUrl(mode, orderDate));
  const setDate = (date: string) => {
    if (!date || date > today) return;
    router.push(dashboardUrl(monitorMode, date));
  };
  const shiftDate = (days: number) => {
    const d = new Date(`${orderDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const [addOrderModal, setAddOrderModal] = useState(false);
  const [editOrderModal, setEditOrderModal] = useState<OrderRow | null>(null);
  const [addItemModal, setAddItemModal] = useState<{ row: OrderRow; prefillProductName?: string; prefillUnit?: string } | null>(null);
  const [editItemModal, setEditItemModal] = useState<OrderItem | null>(null);
  const [unshippedModal, setUnshippedModal] = useState<OrderItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'order' | 'item'; dailyBusinessId?: string; itemId?: string } | null>(null);

  const terminalColors: TerminalColorMap = Object.fromEntries(allTerminals.map((t) => [t.name, { fill: t.fill_color, border: t.border_color }]));
  // 택배·직배송처럼 "별도 주문"으로 표시한 터미널은 기본 주문표에서 빼고, 별도 주문 보기에서만 모아 본다.
  const separateNames = new Set(allTerminals.filter((t) => t.is_separate).map((t) => t.name));
  // 주문표 순서는 주문 입력된 순서 그대로다(업체 번호 = 입력 순서, 서버에서 업체 번호순으로 내려준다).
  // 터미널·상품 수 등으로 다시 정렬하지 않는다.
  // 드래그 직후 서버 반영 전까지 화면에 먼저 보여줄 순서(카드 id 배열). 서버 값이 오면 자연히 사라진다.
  const [optimisticOrder, setOptimisticOrder] = useOptimistic<string[] | null, string[]>(null, (_, next) => next);
  const [, startReorder] = useTransition();
  const allRows = optimisticOrder
    ? optimisticOrder.flatMap((id) => rawRows.find((r) => r.dailyBusinessId === id) ?? [])
    : rawRows;
  const splitBusinessIds = businessIdsInBothRounds(allRows);
  const roundOf = (row: OrderRow): OrderRound | null => (splitBusinessIds.has(row.businessId) ? row.round : null);
  const separateRows = allRows.filter((r) => separateNames.has(r.terminal));
  const mainRows = allRows.filter((r) => !separateNames.has(r.terminal));
  const rows = mainRows;
  const [separateOpen, setSeparateOpen] = useState(false);
  // 품목별 수량은 일반 주문과 별도 주문(택배·직배송 등)을 나눠 센다 — 기본 화면에는 일반 주문 상품만, 별도 주문 상품은 팝업에서 본다.
  const separateDailyIds = new Set(separateRows.map((r) => r.dailyBusinessId));
  const mainItems = items.filter((i) => !separateDailyIds.has(i.dailyBusinessId));
  const separateItems = items.filter((i) => separateDailyIds.has(i.dailyBusinessId));
  const columns = getProductSummary(mainItems);
  const separateColumns = getProductSummary(separateItems);
  // 터미널별 박스는 기본 주문표 기준이다 — 별도 주문 터미널은 "별도 주문" 팝업에서 따로 본다.
  const terminalBoxTotals = getTerminalBoxTotals(mainRows);

  // 표의 상품 열은 더 이상 "오늘 등록된 품목 종류"(columns) 기준이 아니라 "업체 한 곳이
  // 가장 많이 주문한 상품 수 + 1"(마지막은 항상 추가 버튼) 기준이다 — 열 개수가 품목 종류
  // 수에 비례하던 예전 방식은 품목이 늘어날수록 표가 한없이 넓어져 가로 스크롤이 생겼다.

  // 모바일(휴대폰)은 화면이 하나뿐이라 모니터 1/2로 나누는 게 의미가 없다 — 항상 전체보기로
  // 강제한다. 서버 렌더 시점엔 뷰포트를 알 수 없어 기본값(false)으로 그리고 마운트 후
  // matchMedia로 판정해 갱신한다(사이드바 접힘과 같은 패턴 — AGENTS.md 알려진 이슈 참고).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const effectiveMonitorMode = isMobile ? 'all' : monitorMode;
  const isSplitMode = effectiveMonitorMode !== 'all';
  // 표 본문에 쓸 수 있는 높이(스크롤 영역 − 헤더)를 측정해서 행 높이 단계와 줄 수를 정한다.
  // 두 모니터가 같은 높이를 쓰므로 모니터 2는 모니터 1이 가져간 줄 수(ownCapacity) 다음부터 시작한다.
  const [availHeight, setAvailHeight] = useState(0);
  const [availWidth, setAvailWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const headerEl = headerRef.current;
    if (!scrollEl || !headerEl) return;
    const measure = () => {
      setAvailHeight(Math.max(0, scrollEl.clientHeight - headerEl.offsetHeight));
      setAvailWidth(scrollEl.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    ro.observe(headerEl);
    return () => ro.disconnect();
  }, []);

  // 고객명 열 폭: 가장 긴 고객명(굵은 12px)을 한 줄로 그릴 수 있는 폭. 1·2차 배지가 붙는 고객은 배지 폭만큼 더한다.
  // 완료·박스 배지는 상태에 따라 붙었다 떨어지므로 열 폭에 넣지 않는다(폭이 흔들리지 않게). 넘치면 2줄로 접힌다.
  const [nameColumn, setNameColumn] = useState(NAME_COLUMN_DEFAULT);
  const nameSignature = rows.map((r) => `${r.businessName}|${splitBusinessIds.has(r.businessId) ? r.round : ''}`).join('\n');
  useLayoutEffect(() => {
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `700 12px ${getComputedStyle(document.body).fontFamily}`;
      const widest = nameSignature
        .split('\n')
        .filter(Boolean)
        .reduce((max, line) => {
          const [name, round] = line.split('|');
          return Math.max(max, ctx.measureText(name).width + (round ? ROUND_BADGE_WIDTH : 0));
        }, 0);
      // 칸 좌우 여백(px-2 = 16) + 오른쪽 경계선 + 반올림 여유
      setNameColumn(Math.min(NAME_COLUMN_MAX, Math.max(NAME_COLUMN_MIN, Math.ceil(widest) + 20)));
    };
    measure();
    // 웹폰트가 늦게 로드되면 글자 폭이 달라지므로 로드 후 다시 잰다.
    void document.fonts?.ready.then(measure);
  }, [nameSignature]);

  const rowHeight =
    availHeight > 0
      ? ROW_HEIGHT_TIERS.find((h) => MONITOR_COUNT * Math.floor(availHeight / h) >= rows.length) ?? MIN_ROW_HEIGHT
      : ROW_HEIGHT_TIERS[0];
  const ownCapacity = availHeight > 0 ? Math.max(1, Math.floor(availHeight / rowHeight)) : INITIAL_ROW_CAPACITY;
  const startIndex = effectiveMonitorMode === '2' ? ownCapacity : 0;
  // 화면에 다 못 들어가는 줄은 이 화면에 표시하지 않고 다음 모니터로 넘긴다.
  const monitorSlice = isSplitMode ? rows.slice(startIndex, startIndex + ownCapacity) : rows;
  const displayedRows = monitorSlice;

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // 화면에 보이는 구간 안에서만 옮긴다(모니터를 넘나드는 이동은 전체보기에서). 별도 주문 터미널 행은 제자리에 둔다.
  const handleRowDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = displayedRows.findIndex((r) => r.dailyBusinessId === active.id);
    const to = displayedRows.findIndex((r) => r.dailyBusinessId === over.id);
    if (from < 0 || to < 0) return;
    const movedSlice = arrayMove(displayedRows, from, to);
    const nextMain = [...rows.slice(0, startIndex), ...movedSlice, ...rows.slice(startIndex + displayedRows.length)];
    let mainCursor = 0;
    const orderedIds = allRows.map((r) => (separateNames.has(r.terminal) ? r.dailyBusinessId : nextMain[mainCursor++].dailyBusinessId));
    startReorder(async () => {
      setOptimisticOrder(orderedIds);
      await reorderDailyBusinesses(orderedIds);
      router.refresh();
    });
  };
  // 별도 주문 팝업 안에서 순서를 바꾼다. 전체 순서에서 별도 주문 행이 차지한 자리만 새 순서로 채우고, 일반 주문 행은 제자리에 둔다.
  const handleSeparateDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = separateRows.findIndex((r) => r.dailyBusinessId === active.id);
    const to = separateRows.findIndex((r) => r.dailyBusinessId === over.id);
    if (from < 0 || to < 0) return;
    const movedSeparate = arrayMove(separateRows, from, to);
    let separateCursor = 0;
    const orderedIds = allRows.map((r) => (separateNames.has(r.terminal) ? movedSeparate[separateCursor++].dailyBusinessId : r.dailyBusinessId));
    startReorder(async () => {
      setOptimisticOrder(orderedIds);
      await reorderDailyBusinesses(orderedIds);
      router.refresh();
    });
  };
  const rowSlotCount = isSplitMode ? ownCapacity : displayedRows.length;
  // gridTemplateRows를 고정하지 않으면 내용이 긴 칸 하나가 행 전체를 키워서 행 높이 규칙이 깨진다.
  const rowStyle = { height: rowHeight, gridTemplateRows: `${rowHeight}px` };
  // 상품 팁은 한 줄에 다 들어가면 한 줄, 아니면 같은 행 높이 안에서 2줄로 나눠 보여준다(상품명을 말줄임하지 않는다).
  // 한 줄 안의 글자 조각(품목명·수량·단위·사이즈 표기)은 크기가 달라도 기준선에 맞춰 정렬한다(items-baseline) — 가운데 정렬하면 큰 숫자와
  // 작은 글자의 아랫선이 1~2px씩 어긋나 읽기 어렵다.
  // 글자가 잘리지 않게 하는 규칙: 글자를 담는 상자에는 overflow를 걸지 않는다(걸면 kg의 g처럼 기준선 아래로 내려오는 글자가
  // 줄 높이 경계에서 잘린다 — 이 글꼴은 글자 위·아래 여백이 커서 줄 높이를 글자 크기에 가깝게 줄이면 실제로 잘렸다).
  // 잘림은 팁 테두리에서만 일어나므로, 두 줄이 팁 안에 "글자 모양(descender 포함)까지" 들어가는 크기를 고른다.
  // 크기는 3단계를 준비한다: 한 줄일 때(기본) / 두 줄이 팁 안에 들어가는 크기 / 그래도 넘칠 때의 가장 작은 크기.
  // 실제로 어느 단계가 필요한지는 그려진 결과(넘침)를 보고 아래 효과에서 팁마다 정한다.
  // 팁 안쪽 높이 = 행 높이 − 테두리 1 − 칸 여백 4 − 팁 테두리 2.
  const pillInnerHeight = rowHeight - 7;

  // 열 개수는 "이 화면에 실제로 보이는 행" 중 상품이 가장 많은 업체 기준 + 1(추가 버튼 열)이다.
  // 모니터마다 다른 업체가 보이므로 전체 기준이 아니라 화면에 표시되는 행 기준으로 센다.
  const maxProductCount = displayedRows.reduce((max, row) => {
    const count = items.filter((i) => i.dailyBusinessId === row.dailyBusinessId).length;
    return Math.max(max, count);
  }, 0);
  const productSlotCount = maxProductCount + 1;
  const gridTemplate = productGridTemplate(productSlotCount, isSplitMode, nameColumn);
  // 모니터 1/2는 열 폭이 화면 폭으로 정해진다. 상품이 많아 열이 좁아지면 글자도 그만큼 줄인다.
  const colWidth = isSplitMode && availWidth > 0 ? (availWidth - productGridFixedWidth(nameColumn) - ADD_COLUMN_WIDTH) / Math.max(1, productSlotCount - 1) : Infinity;
  const widthShrink = colWidth >= 120 ? 0 : colWidth >= 100 ? 1 : colWidth >= 88 ? 2 : 3;
  const shrinkPill = (q: number, f: number) => ({ q: Math.max(8, q - widthShrink), f: Math.max(7, f - widthShrink) });
  const q2 = Math.min(14, Math.floor((pillInnerHeight - 2) / 2.5));
  // 마지막 단계는 아주 좁은 열(3줄로 접히는 경우)용으로 줄 간격까지 촘촘하게 둔다.
  const pillSteps = [
    { ...shrinkPill(14, 11), lh: 1.15 },
    { ...shrinkPill(q2, Math.min(11, q2 - 1)), lh: 1.15 },
    { q: Math.max(7, q2 - 2 - widthShrink), f: Math.max(6, Math.min(11, q2 - 3) - widthShrink), lh: 1.0 },
  ];
  const pillStepsAttr = pillSteps.map((p) => `${p.q},${p.f},${p.lh}`).join('|');

  // 팁마다 글자 크기 단계를 정한다: 기본 단계부터 시작해, 팁 안쪽 높이를 넘치면 한 단계씩 줄인다.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>('[data-pill]')) {
      const steps = (el.dataset.sizes ?? '').split('|').map((p) => p.split(','));
      let step = Number(el.dataset.start ?? 0);
      const apply = (n: number) => {
        el.style.setProperty('--pq', `${steps[n][0]}px`);
        el.style.setProperty('--pn', `${steps[n][1]}px`);
        el.style.setProperty('--pl', steps[n][2]);
      };
      apply(step);
      while (el.scrollHeight > pillInnerHeight - 2 && step < steps.length - 1) apply(++step);
    }
  });

  // 전체보기 기준(기본 주문표 전체, 입력 순서) 주문 목록을 엑셀에서 열리는 CSV로 내려받는다.
  // 상품 칸은 "상품명 수량단위 (사이즈·중량)"이고, 추가/수정/취소된 상품은 앞에 표시한다.
  const exportOrders = () => {
    const STATUS_PREFIX: Partial<Record<ChangeStatus, string>> = { new: '[추가] ', modified: '[수정] ', cancelled: '[취소] ' };
    const rowItems = mainRows.map((row) =>
      items.filter((i) => i.dailyBusinessId === row.dailyBusinessId).sort((a, b) => a.productSequence - b.productSequence),
    );
    const maxItems = rowItems.reduce((m, list) => Math.max(m, list.length), 0);
    const head = ['번호', '터미널', '고객명', '박스', '메모', ...Array.from({ length: maxItems }, (_, i) => `상품 ${i + 1}`)];
    const lines = mainRows.map((row, idx) => [
      idx + 1,
      row.terminal,
      `${row.businessName}${roundOf(row) ? ` (${roundLabel(roundOf(row) as OrderRound)})` : ''}`,
      row.totalBoxes ?? '',
      row.memo ?? '',
      ...Array.from({ length: maxItems }, (_, i) => {
        const item = rowItems[idx][i];
        if (!item) return '';
        const extra = [item.secondaryWeightKg != null ? `${item.secondaryWeightKg}kg` : null, item.sizeRequest].filter(Boolean).join(', ');
        const unshippedPrefix = item.unshippedQuantity > 0 && item.changeStatus !== 'cancelled' ? `[미출고 ${item.unshippedQuantity}] ` : '';
        return `${STATUS_PREFIX[item.changeStatus] ?? ''}${unshippedPrefix}${item.productName} ${isUndecidedQuantity(item) ? '수량 미정' : `${item.quantity}${item.unit}`}${extra ? ` (${extra})` : ''}`;
      }),
    ]);
    const csv = [head, ...lines].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `주문목록_${orderDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const refresh = () => router.refresh();

  // 강조 상품: 날짜별로 DB에 저장해서 PC와 TV가 같은 선택을 본다. 누르는 즉시 화면에 반영하고 저장은 뒤에서 한다.
  const [hlOpen, setHlOpen] = useState(false);
  const [, startHlTransition] = useTransition();
  const [hlList, setHlOptimistic] = useOptimistic(
    highlights,
    (state: string[], action: { name: string | null; on: boolean }) =>
      action.name === null ? [] : action.on ? [...state.filter((n) => n !== action.name), action.name] : state.filter((n) => n !== action.name),
  );
  const hlColor = new Map(hlList.map((name, i) => [name, HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]]));
  const hlProducts = (() => {
    const counts = new Map<string, number>();
    // 강조 색은 일반 주문 표에만 적용되므로 일반 주문 상품만 고르게 한다.
    for (const i of mainItems) counts.set(i.productName, (counts.get(i.productName) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
  })();
  const toggleHl = (name: string, on: boolean) =>
    startHlTransition(async () => {
      setHlOptimistic({ name, on });
      await setProductHighlight(orderDate, name, on);
      router.refresh();
    });
  const clearHl = () =>
    startHlTransition(async () => {
      setHlOptimistic({ name: null, on: false });
      await clearProductHighlights(orderDate);
      router.refresh();
    });

  const handleTogglePacked = async (item: OrderItem) => {
    if (item.changeStatus === 'cancelled') return;
    await togglePacked(item.id, !item.isPacked);
    refresh();
  };

  const handleSaveOrder = async (data: { businessName: string; terminalId: string | null; round: OrderRound }): Promise<string | null> => {
    if (editOrderModal) {
      const { error } = await updateOrder(editOrderModal.dailyBusinessId, data.businessName, data.terminalId);
      if (error) return error;
      setEditOrderModal(null);
    } else {
      const { error } = await createManualOrder(orderDate, data.round, data.businessName, data.terminalId);
      if (error) return error;
      setAddOrderModal(false);
    }
    refresh();
    return null;
  };

  const handleSaveItem = async (fields: ManualItemFields) => {
    if (editItemModal) {
      await updateOrderItemManual(editItemModal.id, fields);
      setEditItemModal(null);
    } else if (addItemModal) {
      await addOrderItemManual(addItemModal.row.dailyBusinessId, fields);
      setAddItemModal(null);
    }
    refresh();
  };

  // 품목별 수량: 모니터 2는 오른쪽 세로 패널, 전체보기(모바일 포함)는 표 위 카드로 보여준다.
  const chipStyle = (name: string): React.CSSProperties => {
    const c = resolveColors(productColors[name]?.fill, productColors[name]?.border);
    return { backgroundColor: c.fill, borderColor: c.border, color: c.text };
  };
  const renderChips = (list: typeof columns) => list.map((product) => (
    <div
      key={product.key}
      className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5"
      style={chipStyle(product.productName)}
    >
      <span className="text-xs font-bold">{product.label}</span>
      <span className="text-xs font-black">{product.total}{product.unit}</span>
      {product.unshipped > 0 && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded px-1">미출고 {product.unshipped}</span>}
    </div>
  ));
  const productChips = renderChips(columns);
  const [summaryCollapsed, setSummaryCollapsed] = useSummaryCollapsed();
  // 접기 버튼은 카드 아래 가장자리 오른쪽에 반쯤 걸쳐 두어(엑셀의 그룹 접기 단추처럼) 자리를 따로 차지하지 않는다.
  const summaryCard = (
    <div className="relative flex-shrink-0">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #003057' }}>
        {summaryCollapsed ? (
          <div className="flex items-center gap-2 px-3 py-1">
            <span className="text-xs font-bold text-slate-500">품목별 수량</span>
            <span className="text-xs text-slate-400">{columns.length}종 · 접힘</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-3 flex-wrap">
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">품목별 수량</span>
            {productChips}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setSummaryCollapsed(!summaryCollapsed)}
        className="absolute right-3 -bottom-2 z-10 h-4 w-9 rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-800 flex items-center justify-center"
        title={summaryCollapsed ? '품목별 수량 펼치기' : '품목별 수량 접기'}
        aria-label={summaryCollapsed ? '품목별 수량 펼치기' : '품목별 수량 접기'}
        aria-expanded={!summaryCollapsed}
      >
        {summaryCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </button>
    </div>
  );

  const productPanel = <ProductSummaryPanel columns={columns} chipStyle={chipStyle} availHeight={availHeight} />;

  return (
    // 대시보드 페이지의 여백 자체는 dashboard-shell.tsx의 .main-content-tight가 담당한다
    // (12px/16px) — 여기서 음수 마진으로 상쇄하는 방식은 main-content의 overflow-y:auto가
    // overflow-x까지 auto로 끌어올리는 CSS 규칙과 부딪혀 표 오른쪽이 잘려 보이는 버그가 있었다.
    <div className="flex flex-col h-[calc(100vh-24px)] gap-2">
      <div className="flex justify-between items-center bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex-shrink-0 flex-wrap gap-x-2 gap-y-1.5">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1">
            <button onClick={() => shiftDate(-1)} className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center justify-center" title="전날"><ChevronLeft className="w-4 h-4" /></button>
            <input
              type="date"
              value={orderDate}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm font-bold text-slate-800 border border-slate-200 rounded-md px-2 py-1 bg-white"
            />
            <button onClick={() => shiftDate(1)} disabled={orderDate >= today} className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center" title="다음날"><ChevronRight className="w-4 h-4" /></button>
            {isPast ? (
              <>
                <button onClick={() => setDate(today)} className="ml-1 px-2.5 py-1 rounded-md bg-[#003057] text-white text-xs font-bold">오늘</button>
              </>
            ) : (
              <span className="ml-1 px-2 py-1 rounded-md bg-slate-100 text-xs font-bold text-slate-500">오늘</span>
            )}
          </div>
          <div className="w-px h-4 bg-slate-200" />
          {terminalBoxTotals.map(({ terminal, boxes }) => (
            <div key={terminal} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-bold ${terminalBadgeProps(terminal, terminalColors).className}`} style={terminalBadgeProps(terminal, terminalColors).style}>
              <span>{terminal || '(터미널 없음)'}</span>
              <span className="font-black">{boxes}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* 모바일은 화면이 하나뿐이라 모니터 분할 자체가 의미 없다 — 전체보기만 강제되므로 */}
          {/* 선택 버튼도 노출하지 않는다(md 이상, 768px부터 노출 — 위 isMobile 판정 기준과 동일). */}
          <div className="hidden md:flex bg-slate-100 rounded-lg p-1 gap-0.5">
            {([
              { mode: 'all', title: '전체보기', content: <LayoutGrid className="w-4 h-4" /> },
              { mode: '1', title: '모니터 1', content: <><Monitor className="w-4 h-4" /><span>1</span></> },
              { mode: '2', title: '모니터 2', content: <><Monitor className="w-4 h-4" /><span>2</span></> },
            ] as const).map(({ mode, title, content }) => (
              <button
                key={mode}
                onClick={() => setMonitorMode(mode)}
                title={title}
                aria-label={title}
                className={`h-7 min-w-8 px-2 inline-flex items-center justify-center gap-1 text-xs font-bold rounded-md transition-colors ${monitorMode === mode ? 'bg-white shadow-sm text-[#003057]' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {content}
              </button>
            ))}
          </div>
          {separateNames.size > 0 && (
            <button
              onClick={() => setSeparateOpen(true)}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-bold rounded-lg border transition-colors bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
              title={`별도 주문 보기 (택배·직배송 등) — ${separateRows.length}건`}
              aria-label="별도 주문 보기"
            >
              <Truck className="w-4 h-4" />
              {separateRows.length}
            </button>
          )}
          {!readOnly && <button
            onClick={() => setAddOrderModal(true)}
            className="w-8 h-8 rounded-lg text-white shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center"
            style={{ backgroundColor: '#003057' }}
            title="새 주문 추가"
            aria-label="새 주문 추가"
          >
            <Plus className="w-4 h-4" />
          </button>}
          <div className="relative">
            <button
              onClick={() => setHlOpen((v) => !v)}
              className={`h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-bold rounded-lg border transition-colors ${hlList.length > 0 ? 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-100'}`}
              title="오늘 강조할 상품 선택 — 주문표에서 그 상품의 이름 색이 달라집니다"
              aria-label="강조 상품 선택"
              aria-expanded={hlOpen}
            >
              <Highlighter className="w-4 h-4" />
              {hlList.length > 0 && hlList.length}
            </button>
            {hlOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHlOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-72 max-h-[60vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-lg p-2">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-xs font-bold text-slate-700">강조할 상품</span>
                    {hlList.length > 0 && <button onClick={clearHl} className="text-xs text-slate-500 hover:text-slate-800">모두 해제</button>}
                  </div>
                  {hlProducts.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">이 날짜에 주문된 상품이 없습니다.</p>}
                  {hlProducts.map(({ name, count }) => {
                    const color = hlColor.get(name);
                    return (
                      <button key={name} onClick={() => toggleHl(name, !color)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 text-left">
                        <span className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={color ? { background: color, borderColor: color } : { borderColor: '#cbd5e1' }}>
                          {color && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
                        </span>
                        <span className="text-sm font-semibold truncate" style={color ? { color } : undefined}>{name}</span>
                        <span className="ml-auto text-xs text-slate-400 flex-shrink-0">{count}곳</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <button
            onClick={exportOrders}
            disabled={mainRows.length === 0}
            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 transition-colors flex items-center justify-center"
            title="주문 목록 엑셀(CSV) 다운로드 — 전체보기 기준"
            aria-label="주문 목록 엑셀 다운로드"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {effectiveMonitorMode === 'all' && summaryCard}

      <div className="flex flex-1 min-h-0 gap-2">
      <div className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative">
        {/* 전체 주문이 0건일 땐 어느 모니터를 보든 이유가 같으므로(범위 문제가 아니라 주문
            자체가 없는 것) 병합보기와 같은 일반 문구를 쓴다. 전체엔 주문이 있는데 이 모니터
            범위(모니터 1에 들어간 줄 수 이후)에만 없을 때만 안내한다. */}
        {isSplitMode && monitorSlice.length === 0 && rows.length > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 pointer-events-none z-10">
            <Inbox className="w-7 h-7 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-medium">이 모니터에 표시할 주문이 없습니다</p>
            <p className="text-xs text-slate-400 max-w-xs text-center leading-relaxed">
              오늘 전체 주문 {rows.length}건 중 {effectiveMonitorMode === '2'
                ? `모니터 2는 ${startIndex + 1}번째 주문부터 표시됩니다. 아직 그만큼 쌓이지 않았습니다.`
                : `모니터 1은 1~${ownCapacity}번째 주문을 표시합니다.`}
            </p>
          </div>
        )}
        {isSplitMode && rows.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 pointer-events-none z-10">
            <Inbox className="w-8 h-8 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-medium">주문이 없습니다</p>
            <p className="text-xs text-slate-400">&apos;새 주문 추가&apos; 버튼을 누르거나, &apos;주문 입력&apos; 메뉴에서 카카오톡 메시지로 등록하세요</p>
          </div>
        )}
        <div ref={scrollRef} className={`flex-1 min-h-0 overflow-x-auto ${isSplitMode ? 'overflow-y-hidden' : 'overflow-y-auto'}`}>
          <div className={`flex flex-col ${isSplitMode ? 'h-full' : ''}`} style={isSplitMode ? undefined : { minWidth: productGridMinWidth(productSlotCount, nameColumn) }}>
            {/* 헤더 */}
            <div
              ref={headerRef}
              className={`grid text-white text-xs font-bold flex-shrink-0 ${!isSplitMode ? 'sticky top-0 z-10' : ''}`}
              style={{ backgroundColor: '#003057', gridTemplateColumns: gridTemplate }}
            >
              <div className="border-r border-b-2 border-white/20 px-2 py-1.5 flex items-center justify-center">No</div>
              <div className="border-r border-b-2 border-white/20 px-2 py-1.5 flex items-center justify-center">터미널</div>
              <div className="border-r border-b-2 border-white/20 px-3 py-1.5 flex items-center">고객명</div>
              <div className="border-r border-b-2 border-white/20 px-2 py-1.5 flex items-center justify-center">박스</div>
              {Array.from({ length: productSlotCount }).map((_, i) => (
                <div
                  key={i}
                  className="border-r last:border-r-0 border-b-2 border-white/20 px-1.5 py-1.5 flex items-center justify-center text-center"
                >
                  {isSplitMode && i === productSlotCount - 1 ? '' : `상품 ${i + 1}`}
                </div>
              ))}
            </div>

            {/* 본문 — 모니터 1/2는 측정된 가용 높이에 들어가는 만큼(ROW_HEIGHT 단위)만 그려 스크롤이 없다 */}
            <DndContext id="dashboard-dnd" sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
            <SortableContext items={displayedRows.map((r) => r.dailyBusinessId)} strategy={verticalListSortingStrategy}>
            <div className={`flex flex-col ${isSplitMode ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
              {Array.from({ length: rowSlotCount }).map((_, index) => {
                const row = displayedRows[index];

                if (!row) {
                  return isSplitMode ? (
                    <div key={`empty-${index}`} className="shrink-0 border-b border-slate-100" style={rowStyle} />
                  ) : null;
                }

                // 상품은 주문 입력(등록)된 순서 그대로 왼쪽부터 배치한다 — 입력하는 사람이 순서를 의도해서
                // 쓰므로 시스템이 다시 정렬하지 않는다(productSequence = 입력 순서).
                const rowItems = items
                  .filter((i) => i.dailyBusinessId === row.dailyBusinessId)
                  .sort((a, b) => a.productSequence - b.productSequence);

                return (
                  <SortableRow
                    key={row.dailyBusinessId}
                    id={row.dailyBusinessId}
                    disabled={readOnly}
                    className="group/row grid border-b border-slate-100 hover:bg-slate-50/50 transition-colors shrink-0"
                    style={{ gridTemplateColumns: gridTemplate, ...rowStyle }}
                  >
                    {(handle) => (
                    <>
                    <div className="border-r border-slate-100 px-2 flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-50">
                      {handle ? (
                        <div
                          ref={handle.ref}
                          {...handle.props}
                          className="relative w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
                          title="끌어서 순서 변경"
                        >
                          <span className="group-hover/row:invisible">{index + startIndex + 1}</span>
                          <GripVertical className="absolute w-4 h-4 text-slate-500 invisible group-hover/row:visible" />
                        </div>
                      ) : (
                        index + startIndex + 1
                      )}
                    </div>
                    <div className="border-r border-slate-100 px-2 flex items-center justify-center">
                      <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md border text-[11px] font-bold ${terminalBadgeProps(row.terminal, terminalColors).className}`} style={terminalBadgeProps(row.terminal, terminalColors).style}>
                        {row.terminal || '-'}
                      </span>
                    </div>
                    <div className={`relative border-r border-slate-100 px-2 flex items-center group overflow-hidden ${isCardComplete(rowItems) ? 'bg-emerald-50' : ''}`}>
                      {/* 업체명은 현장에서 정확히 보여야 하므로 말줄임 없이 전체 폭을 쓰고(최대 2줄, 행 높이 고정),
                          수정/삭제 버튼은 마우스를 올릴 때만 이름 위에 겹쳐 나타난다. */}
                      <span className="text-xs font-bold text-slate-700 leading-[1.15] break-keep line-clamp-2" title={row.memo ?? undefined}>{isCardComplete(rowItems) && <DoneBadge />}{roundOf(row) && <RoundBadge round={roundOf(row) as OrderRound} />}{row.businessName}</span>
                      {row.memo && <span className="ml-1 w-1.5 h-1.5 shrink-0 rounded-full bg-amber-400" />}
                      {row.packingChanged && <span className="ml-1 shrink-0 rounded border border-rose-300 bg-rose-50 px-1 text-[10px] font-extrabold leading-tight text-rose-600" title="주문이 바뀌었습니다 — 박스 할당에서 박스 구성을 다시 확인하세요">박스</span>}
                      <div className={`absolute inset-y-0 right-0 pl-4 pr-1 flex items-center gap-1 opacity-0 ${readOnly ? 'hidden' : ''} group-hover:opacity-100 transition-opacity bg-gradient-to-l from-white via-white to-transparent`}>
                      <button
                        onClick={() => setEditOrderModal(row)}
                        className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-600 flex items-center justify-center flex-shrink-0"
                        title="주문 수정"
                      >
                        <Pencil className="w-2.5 h-2.5 text-slate-500 hover:text-white" />
                      </button>
                      {canDelete && <button
                        onClick={() => setConfirmDelete({ type: 'order', dailyBusinessId: row.dailyBusinessId })}
                        className="w-5 h-5 rounded bg-rose-100 hover:bg-rose-500 flex items-center justify-center flex-shrink-0"
                        title="주문 삭제"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-rose-500 hover:text-white" />
                      </button>}
                      </div>
                    </div>
                    <div className="border-r border-slate-100 px-2 bg-slate-50/60 flex items-center justify-center">
                      <span className={`text-sm font-bold tabular-nums ${row.totalBoxes == null ? 'text-slate-300' : 'text-slate-700'}`} title="박스 할당에서 정한 박스 수">{row.totalBoxes ?? '-'}</span>
                    </div>

                    {Array.from({ length: productSlotCount }).map((_, slotIndex) => {
                      const item = rowItems[slotIndex];

                      if (!item) {
                        // 업체 메모는 "+" 버튼 뒤 남는 빈 칸들을 하나로 합쳐서 보여준다(칸이 모자라면 이름 옆 점으로 대신).
                        if (row.memo && slotIndex > rowItems.length) {
                          if (slotIndex !== rowItems.length + 1) return null;
                          return (
                            <div
                              key={slotIndex}
                              className="px-2 flex items-center text-[11px] font-bold leading-[1.15] text-amber-700 bg-amber-50/60 line-clamp-2 overflow-hidden"
                              style={{ gridColumn: `span ${productSlotCount - slotIndex}` }}
                            >
                              <span className="line-clamp-2">메모: {row.memo}</span>
                            </div>
                          );
                        }
                        // 이 업체의 상품이 끝난 바로 다음 칸에만 추가 버튼을 두고, 그 뒤는 완전히
                        // 빈 칸으로 둔다 — 열이 더 이상 고정 품목이 아니라서 "이 상품이 없다"는
                        // 뜻의 점선 박스를 칸마다 반복할 이유가 없다.
                        if (slotIndex !== rowItems.length || readOnly) {
                          // 테두리는 다른 칸과 똑같이 그려서 열 경계가 행마다 어긋나 보이지
                          // 않게 한다(내용만 비워둔다 — 이 업체는 그만큼 상품이 없다는 뜻).
                          return <div key={slotIndex} className="border-r border-slate-100 last:border-r-0" />;
                        }
                        return (
                          <div key={slotIndex} className="border-r border-slate-100 last:border-r-0 p-[2px] flex min-w-0">
                            <div
                              onClick={() => setAddItemModal({ row })}
                              className="w-full flex items-center justify-center rounded-lg border border-dashed border-slate-200 cursor-pointer hover:border-sky-400 hover:bg-sky-50/40 transition-all group"
                            >
                              <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-sky-400 transition-colors" />
                            </div>
                          </div>
                        );
                      }

                      const { bg, border, text } = getItemStyle(item.changeStatus, item.isPacked, item.unshippedQuantity, item.quantity);
                      // 강조 상품은 이름만 색을 바꾼다. 취소·포장 완료 칸은 상태 표시(취소선, 회색)가 우선한다.
                      const highlightColor = item.changeStatus !== 'cancelled' && !item.isPacked ? hlColor.get(item.productName) : undefined;
                      const suffixParts: string[] = [];
                      if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
                      if (item.sizeRequest) suffixParts.push(item.sizeRequest);
                      const suffix = suffixParts.length ? ` (${suffixParts.join(', ')})` : '';

                      return (
                        <div key={item.id} className="border-r border-slate-100 last:border-r-0 p-[2px] flex min-w-0">
                          <div className={`relative w-full flex items-center justify-center px-1.5 rounded-lg border overflow-hidden ${bg} ${border} transition-all group shadow-sm`}>
                            {item.unshippedQuantity > 0 && item.changeStatus !== 'cancelled' && (
                              <span
                                className="absolute top-0 left-0 z-20 text-[9px] font-bold leading-none px-1 py-[2px] rounded-br bg-amber-500 text-white"
                                title={item.unshippedReason ? `미출고 사유: ${item.unshippedReason}` : '미출고'}
                              >
                                미출고 {item.unshippedQuantity}
                              </span>
                            )}
                            {item.isPacked && item.changeStatus !== 'cancelled' && (
                              <Check className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-slate-400/30" strokeWidth={4} />
                            )}
                            <div
                              data-pill
                              data-sizes={pillStepsAttr}
                              data-start={suffix ? 1 : 0}
                              onClick={() => !readOnly && handleTogglePacked(item)}
                              className="w-full min-w-0 flex flex-wrap items-baseline justify-center gap-x-1 z-10 cursor-pointer select-none break-keep [overflow-wrap:anywhere]"
                              // 컨테이너의 글자 크기도 칩 글자 크기에 맞춘다: 안 맞추면 수량을 감싼 상자의 보이지 않는 줄 높이(strut)가 부모의 큰 기본 글자
                              // 크기로 잡혀서, 작은 글자 단계에서 글자가 칩 아래쪽으로 치우친다.
                              style={{ fontSize: 'var(--pq)', lineHeight: 'var(--pl, 1.15)', maxHeight: pillInnerHeight }}
                            >
                              <span className={highlightColor ? 'font-black' : `font-bold ${text}`} style={{ fontSize: 'var(--pn)', ...(highlightColor ? { color: highlightColor } : {}) }}>{item.productName}</span>
                              {isUndecidedQuantity(item) ? (
                                <span className="whitespace-nowrap rounded bg-amber-100 px-1 font-black text-amber-700" style={{ fontSize: 'var(--pn)' }} title="주문에서 수량을 못 찾았습니다. 수정에서 수량을 채워 주세요">수량 미정</span>
                              ) : (
                                <span className="whitespace-nowrap">
                                  <span className={`font-black ${text}`} style={{ fontSize: 'var(--pq)' }}>{item.quantity}</span>
                                  <span className={`ml-0.5 font-semibold ${text}`} style={{ fontSize: 'var(--pn)' }}>{item.unit}</span>
                                </span>
                              )}
                              {suffix && <span className="font-semibold text-sky-600" style={{ fontSize: 'var(--pn)' }}>{suffix.trim()}</span>}
                            </div>
                            <div className={`absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 ${readOnly ? 'hidden' : ''} group-hover:opacity-100 transition-opacity z-20`}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditItemModal(item); }}
                                className="w-4 h-4 rounded bg-slate-600 text-white flex items-center justify-center hover:bg-slate-800 transition-colors"
                                title="수정"
                              ><Pencil className="w-2.5 h-2.5" /></button>
                              {item.changeStatus !== 'cancelled' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setUnshippedModal(item); }}
                                  className="w-4 h-4 rounded bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors"
                                  title="미출고 처리 (주문은 유효, 출고만 못 함)"
                                ><PackageX className="w-2.5 h-2.5" /></button>
                              )}
                              {canDelete && item.changeStatus !== 'cancelled' && (
                                <button
                                  onClick={async (e) => { e.stopPropagation(); await cancelOrderItem(item.id); refresh(); }}
                                  className="w-4 h-4 rounded bg-amber-400 text-white flex items-center justify-center hover:bg-amber-500 transition-colors"
                                  title="주문 취소 (주문 자체가 없어짐)"
                                ><X className="w-2.5 h-2.5" /></button>
                              )}
                              {canDelete && <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'item', itemId: item.id }); }}
                                className="w-4 h-4 rounded bg-rose-400 text-white flex items-center justify-center hover:bg-rose-600 transition-colors"
                                title="삭제"
                              ><Trash2 className="w-2.5 h-2.5" /></button>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </>
                    )}
                  </SortableRow>
                );
              })}

              {rows.length === 0 && !isSplitMode && (
                <div className="py-20 flex flex-col items-center gap-2 text-slate-400">
                  <Inbox className="w-8 h-8 text-slate-300" strokeWidth={1.5} />
                  <p className="text-sm font-medium">주문이 없습니다</p>
                  <p className="text-xs text-slate-400">&apos;새 주문 추가&apos; 버튼을 누르거나, &apos;주문 입력&apos; 메뉴에서 카카오톡 메시지로 등록하세요</p>
                </div>
              )}
            </div>
            </SortableContext>
            </DndContext>
          </div>
        </div>
      </div>
        {effectiveMonitorMode === '2' && productPanel}
      </div>

      {separateOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setSeparateOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl flex-shrink-0" style={{ backgroundColor: '#003057' }}>
              <h3 className="text-sm font-bold text-white tracking-wide">별도 주문 ({separateRows.length}) — {[...separateNames].join(', ')}</h3>
              <button onClick={() => setSeparateOpen(false)} className="text-white/70 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 min-h-0 flex gap-3 p-4">
            <div className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-2">
              {separateRows.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-10">별도 주문이 없습니다. 터미널 관리에서 &apos;별도 주문&apos;으로 지정한 터미널의 주문이 여기에 모입니다.</p>
              )}
              <DndContext id="separate-dnd" sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleSeparateDragEnd}>
              <SortableContext items={separateRows.map((r) => r.dailyBusinessId)} strategy={verticalListSortingStrategy}>
              {separateRows.map((row, index) => {
                const rowItems = items.filter((i) => i.dailyBusinessId === row.dailyBusinessId).sort((a, b) => a.productSequence - b.productSequence);
                return (
                  <SortableRow
                    key={row.dailyBusinessId}
                    id={row.dailyBusinessId}
                    disabled={readOnly}
                    className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-1.5 group bg-white"
                    style={{}}
                  >
                    {(handle) => (
                    <>
                    <span className="w-6 flex-shrink-0 text-center text-xs font-bold text-slate-400">{index + 1}</span>
                    {handle && (
                      <div
                        ref={handle.ref}
                        {...handle.props}
                        className="flex-shrink-0 -ml-1 p-1 rounded cursor-grab active:cursor-grabbing touch-none select-none text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        title="끌어서 순서 변경"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    )}
                    <div className="w-72 flex-shrink-0 flex items-center gap-2">
                      <span className={`whitespace-nowrap flex-shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-bold ${terminalBadgeProps(row.terminal, terminalColors).className}`} style={terminalBadgeProps(row.terminal, terminalColors).style}>{row.terminal}</span>
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 break-keep leading-tight">{isCardComplete(rowItems) && <DoneBadge />}{roundOf(row) && <RoundBadge round={roundOf(row) as OrderRound} />}{row.businessName}</span>
                      <span className="flex-shrink-0 text-xs text-slate-500 whitespace-nowrap">박스 {row.totalBoxes ?? '-'}</span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                      {row.memo && <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">메모: {row.memo}</span>}
                      {rowItems.map((item) => {
                        const { bg, border, text } = getItemStyle(item.changeStatus, item.isPacked, item.unshippedQuantity, item.quantity);
                        const suffixParts: string[] = [];
                        if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
                        if (item.sizeRequest) suffixParts.push(item.sizeRequest);
                        return (
                          <div key={item.id} className={`relative group/pill flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs ${bg} ${border} ${text} ${readOnly ? '' : 'cursor-pointer'}`} onClick={() => !readOnly && handleTogglePacked(item)}>
                            <span className="flex items-baseline gap-1 min-w-0">
                              <span className="font-bold">{item.productName}</span>
                              {isUndecidedQuantity(item) ? (
                                <span className="font-black text-amber-700">수량 미정</span>
                              ) : (
                                <>
                                  <span className="font-black text-sm">{item.quantity}</span>
                                  <span className="font-semibold">{item.unit}</span>
                                </>
                              )}
                              {suffixParts.length > 0 && <span className="font-semibold text-sky-600">({suffixParts.join(', ')})</span>}
                              {item.unshippedQuantity > 0 && item.changeStatus !== 'cancelled' && (
                                <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1 py-[1px]" title={item.unshippedReason ?? undefined}>미출고 {item.unshippedQuantity}</span>
                              )}
                            </span>
                            {!readOnly && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditItemModal(item); }}
                                className="ml-1 w-4 h-4 rounded bg-slate-600 text-white items-center justify-center hidden group-hover/pill:flex"
                                title="수정"
                              ><Pencil className="w-2.5 h-2.5" /></button>
                            )}
                            {!readOnly && item.changeStatus !== 'cancelled' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setUnshippedModal(item); }}
                                className="w-4 h-4 rounded bg-indigo-500 text-white items-center justify-center hidden group-hover/pill:flex"
                                title="미출고 처리"
                              ><PackageX className="w-2.5 h-2.5" /></button>
                            )}
                          </div>
                        );
                      })}
                      {!readOnly && (
                        <button onClick={() => setAddItemModal({ row })} className="px-2.5 py-1 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-sky-400 hover:text-sky-500 text-xs flex items-center">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    </>
                    )}
                  </SortableRow>
                );
              })}
              </SortableContext>
              </DndContext>
            </div>
            {separateColumns.length > 0 && <ProductSummaryPanel columns={separateColumns} chipStyle={chipStyle} />}
            </div>
          </div>
        </div>
      )}

      {addOrderModal && (
        <OrderFormModal terminals={allTerminals} businesses={businessDirectory} registered={allRows.map((r) => ({ businessId: r.businessId, round: r.round, terminal: r.terminal }))} onSave={handleSaveOrder} onClose={() => setAddOrderModal(false)} />
      )}
      {editOrderModal && (
        <OrderFormModal
          initial={{
            businessName: editOrderModal.businessName,
            terminalId: allTerminals.find((t) => t.name === editOrderModal.terminal)?.id ?? null,
          }}
          terminals={allTerminals}
          businesses={businessDirectory}
          onSave={handleSaveOrder}
          onClose={() => setEditOrderModal(null)}
        />
      )}
      {addItemModal && (
        <ItemFormModal
          mode="add"
          initial={{ productName: addItemModal.prefillProductName, unit: addItemModal.prefillUnit, changeStatus: 'new' }}
          onSave={handleSaveItem}
          onClose={() => setAddItemModal(null)}
        />
      )}
      {unshippedModal && (
        <UnshippedModal
          item={unshippedModal}
          reasons={unshippedReasons}
          onSave={async (qty, reason) => {
            const result = await setItemUnshipped(unshippedModal.id, qty, reason);
            if (result.error) return result.error;
            setUnshippedModal(null);
            refresh();
            return null;
          }}
          onClose={() => setUnshippedModal(null)}
        />
      )}
      {editItemModal && (
        <ItemFormModal
          mode="edit"
          initial={{
            productName: editItemModal.productName,
            quantity: editItemModal.quantity,
            unit: editItemModal.unit,
            secondaryWeightKg: editItemModal.secondaryWeightKg ?? null,
            sizeRequest: editItemModal.sizeRequest ?? null,
            changeStatus: editItemModal.changeStatus,
          }}
          onSave={handleSaveItem}
          onClose={() => setEditItemModal(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          message={
            confirmDelete.type === 'order'
              ? '이 주문을 완전히 삭제하시겠습니까? 등록된 상품도 모두 함께 삭제됩니다.'
              : '이 상품을 주문에서 삭제하시겠습니까? 취소 상태로만 변경하려면 "×" 버튼을 이용하세요.'
          }
          onConfirm={async () => {
            if (confirmDelete.type === 'order' && confirmDelete.dailyBusinessId) {
              await deleteDailyBusiness(confirmDelete.dailyBusinessId);
            } else if (confirmDelete.itemId) {
              await deleteOrderItem(confirmDelete.itemId);
            }
            refresh();
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
