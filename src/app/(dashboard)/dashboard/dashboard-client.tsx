'use client';
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useOptimistic, useSyncExternalStore, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Check, GripVertical, Plus, Pencil, X, Inbox, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Highlighter, LayoutGrid, Monitor, PenLine, TriangleAlert, Truck } from 'lucide-react';
import { businessIdsInBothRounds, isCardCancelled, prepLabelOf, prepOf, type Prep, roundLabel, getProductSummary, getProductCustomers, getTerminalBoxTotals, isCardComplete, isUndecidedQuantity, productDelta, formatDelta, type OrderItem, type OrderRow, type ProductSummaryRow, type ChangeStatus, type OrderRound } from '@/lib/orders';
import { terminalBadgeProps, terminalDotProps, type TerminalColorMap } from '@/lib/terminal-color';
import { resolveColors } from '@/lib/color-palette';
import { useCan } from '@/components/permissions-context';
import { useLocalFlag } from '@/lib/use-local-flag';
import { DashboardMobile } from './dashboard-mobile';
import { DashboardSound } from './dashboard-sound';
import { InkLayer, type InkItem } from './ink-layer';
import { ProductCustomersPopover } from './product-customers-popover';
import { CustomerOrderPanel } from './customer-order-panel';
import { BoxAssignModal } from './box-assign-modal';
import { fitRowHeight } from '@/lib/row-fit';
import { packRows } from '@/lib/page-rows';
import { useTouchDesktop } from '@/lib/use-touch-desktop';
import { useHydrated } from '@/lib/use-hydrated';
import { useToast, useUndoToast } from '@/components/toast';
import {
  setProductHighlight,
  clearProductHighlights,
  togglePacked,
  reorderDailyBusinesses,
  createManualOrder,
  loadBusinessDirectory,
  updateOrder,
  renameDailyBusiness,
  deleteDailyBusiness,
  addOrderItemManual,
  updateOrderItemManual,
  cancelOrderItem,
  restoreOrderItem,
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
const ROW_FIT_MAX_SHRINK = 6; // 하단 자투리에 한 행을 더 넣으려고 행을 줄일 수 있는 최대 높이(px)
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
// 추가(+N)·미정 배지는 칩 글자보다 작게, 위아래 여백을 1px만 둬서 칩 테두리에 닿지 않게 한다(15px 칩에서 배지가 테두리를 넘어 보였다).
// 별도 주문 팝업 표의 행 촘촘함 단계(0 = 넉넉함). 칸 안쪽 여백과 칩·번호 칸의 최소 높이만 줄이고 글자 크기는 바꾸지 않는다(글자 잘림 점검 대상 아님).
const SEP_DENSITIES = [
  { cell: 'p-[3px]', chip: 'min-h-[44px] py-1', name: 'py-1.5', no: 'min-h-[44px]' },
  { cell: 'p-[2px]', chip: 'min-h-[34px] py-0.5', name: 'py-1', no: 'min-h-[34px]' },
  { cell: 'p-[1px]', chip: 'min-h-[28px] py-0', name: 'py-0.5', no: 'min-h-[28px]' },
] as const;
const NO_ITEMS: OrderItem[] = [];
const DELTA_TITLE = '처음 입력 이후 바뀐 수량: 새로 추가된 수량과, 이미 있던 품목의 수량을 고친 만큼의 합(줄면 −)';
const SUMMARY_BADGE_STYLE: React.CSSProperties = { padding: '1px 3px', fontSize: '0.9em' };
function ProductSummaryPanel({
  columns,
  chipStyle,
  availHeight,
  onPick,
}: {
  columns: ProductSummaryRow[];
  chipStyle: (name: string) => React.CSSProperties;
  availHeight?: number;
  onPick: (product: ProductSummaryRow, rect: DOMRect) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const signature = `${columns.map((c) => `${c.key}:${c.total}:${c.added}:${c.changed}:${c.unshipped}:${c.undecided}`).join('|')}@${availHeight ?? ''}`;
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
    <aside className="w-52 flex-shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ borderTop: '3px solid var(--soft-brass, #003057)' }}>
      <div className="px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50 border-b border-slate-100 flex-shrink-0">품목별 수량</div>
      <div ref={gridRef} className={`flex-1 min-h-0 flex flex-wrap content-start gap-x-1 p-1.5 ${availHeight === undefined ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        {columns.map((product) => (
          <div
            key={product.key}
            role="button"
            tabIndex={0}
            title="누르면 이 상품을 주문한 고객사를 봅니다"
            onClick={(e) => onPick(product, e.currentTarget.getBoundingClientRect())}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(product, e.currentTarget.getBoundingClientRect()))}
            className="flex items-center justify-between gap-1 px-1.5 rounded border mb-px cursor-pointer"
            style={{ ...chipStyle(product.productName), minHeight: itemHeight - 1, fontSize: Math.min(12, itemHeight - 6), flex: '1 1 auto', maxWidth: '100%' }}
          >
            <span className="font-bold break-keep leading-tight">{product.label}</span>
            <span className="font-black shrink-0 whitespace-nowrap leading-tight">
              {product.undecided > 0 ? (
                <span className="inline-block rounded bg-amber-100 leading-none text-amber-700" style={SUMMARY_BADGE_STYLE} title="주문에서 수량을 못 찾은 상품입니다. 주문을 수정해서 수량을 채워 주세요">미정 {product.undecided}곳</span>
              ) : (
                <>
                  {product.total}{product.unit}
                  {productDelta(product) !== 0 && <span className="ml-1 inline-block rounded bg-white/70 leading-none text-sky-700" style={SUMMARY_BADGE_STYLE} title={DELTA_TITLE}>{formatDelta(productDelta(product), product.unit)}</span>}
                  {product.unshipped > 0 && <span className="ml-1 text-amber-700">(미출고 {product.unshipped})</span>}
                </>
              )}
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

// 별도 주문 팝업의 고객명. 누르면 그 자리에서 고칠 수 있다 — 바뀐 이름은 이 날짜의 카드에만 적용되고 고객사 관리의 이름은 그대로다.
// 비우거나 고객사 이름과 같게 쓰면 기본 이름으로 돌아간다.
function EditableCardName({ row, readOnly, onOpen }: { row: OrderRow; readOnly: boolean; onOpen: (el: HTMLElement) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.businessName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = row.businessName !== row.defaultName;

  const save = async () => {
    if (busy) return;
    if (draft.trim() === row.businessName) return setEditing(false);
    setBusy(true);
    setError(null);
    const result = await renameDailyBusiness(row.dailyBusinessId, draft);
    setBusy(false);
    if (result.error) return setError(result.error);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <input
          autoFocus
          value={draft}
          maxLength={60}
          disabled={busy}
          placeholder={row.defaultName}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
            if (e.key === 'Escape') {
              setDraft(row.businessName);
              setEditing(false);
            }
          }}
          className="w-44 rounded-md border border-sky-400 px-1.5 py-0.5 text-sm font-bold text-slate-800 focus:outline-none"
        />
        {error ? <span className="text-[10px] font-bold text-rose-600">{error}</span> : <span className="text-[10px] text-slate-400">이 날짜만 바뀝니다 · 비우면 &apos;{row.defaultName}&apos;</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1">
      {readOnly ? (
        <span>{row.businessName}</span>
      ) : (
        <span role="button" tabIndex={0} title="누르면 이 고객의 상품 추가·수정·미출고·취소·삭제" className="cursor-pointer hover:underline" onClick={(e) => onOpen(e.currentTarget)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(e.currentTarget))}>{row.businessName}</span>
      )}
      {changed && <span className="text-[10px] font-bold text-sky-600" title={`고객사 관리의 이름: ${row.defaultName}`}>(변경)</span>}
      {!readOnly && (
        <button
          type="button"
          onClick={() => { setDraft(row.businessName); setEditing(true); }}
          className="ml-0.5 w-4 h-4 rounded bg-slate-100 hover:bg-slate-600 text-slate-500 hover:text-white items-center justify-center hidden group-hover:inline-flex self-center"
          title="이 날짜의 고객명 수정"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      )}
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

// 주문 상품이 모두 취소된 고객사 표시. 이 고객사는 박스 할당·라벨 출력·상차가 필요 없다.
function CancelledBadge() {
  return (
    <span className="inline-flex items-center align-middle mr-1 px-1 rounded border border-rose-300 bg-rose-100 text-rose-700 text-[10px] font-extrabold leading-[14px]" title="이 업체의 모든 주문이 취소되었습니다 — 박스 할당·라벨 출력·상차가 필요 없습니다">
      취소
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
// 전체보기는 열마다 최소 폭을 두고 필요하면 옆으로 스크롤한다. (PC 표에는 상품을 직접 추가하는 "+" 칸이 없다 — 2026-11-14 사용자 결정.)
// 고객명 열은 이 날짜 고객명 중 가장 긴 것에 맞춘다(모니터 1·2가 같은 폭을 쓰도록 표시 중인 줄이 아니라 전체 줄 기준).
// 수정/삭제 버튼은 이름 위에 겹쳐 나타나므로 버튼 자리를 따로 잡지 않는다.
// 모니터 1·2의 상품 열 최대 폭(px). 상품 열이 적을 때(예: 모니터 2에 3열뿐) 열이 화면 폭만큼 늘어나면 65인치 칠판에서 작업자가 고개를 많이 돌려야 해서 상한을 둔다
// (2026-11-14 현장 요청). 이 폭이면 가장 긴 한 줄 칩("활장어 2kg (키로6-8미, 기포기)")이 한 줄에 들어가고, 1920px 화면에서 열이 9개일 때의 열 폭(사이드바를 펼치면 약 150px,
// 접으면 약 175px)보다 크다. 열이 그보다 많으면 지금처럼 화면 폭을 나눠 쓰므로 이 상한은 열이 적을 때만 작동한다.
// 남는 폭은 표 오른쪽에 빈 자리로 남고, 모니터 2의 품목별 수량 패널은 표 바로 옆에 붙는다.
const PRODUCT_COLUMN_MAX = 200;
const NAME_COLUMN_DEFAULT = 144;
// 터미널 열 폭: 가장 긴 터미널 이름 칩(굵은 11px)에 맞춘다. 수정·삭제 버튼은 고객명을 눌러 여는 패널로 옮겨서(2026-11-14) 버튼 자리는 잡지 않는다.
const TERMINAL_COLUMN_DEFAULT = 64;
const TERMINAL_COLUMN_MIN = 56; // 표 머리 "터미널"이 들어가는 폭
const TERMINAL_COLUMN_MAX = 120;
const NAME_COLUMN_MIN = 72;
const NAME_COLUMN_MAX = 220;
const ROUND_BADGE_WIDTH = 28; // RoundBadge("1차") 폭 + 오른쪽 간격
// 박스 열 폭(고정). 박스 수는 최대 두 자리라서 숫자(14px 굵게 약 17px) + 박스 재확인 경고 아이콘(14px) + 합포장 배지 "합"(약 18px) + 사이 간격과 좌우 여백이 한 줄에
// 모두 들어가는 최소 폭이다. 헤더 "박스"(12px 굵게)는 이보다 좁다. 합포장 전체 이름은 배지 툴팁으로 본다.
const BOX_COLUMN = 64;
const noopId = (id: string) => void id;
const noopActive = (active: boolean) => void active;
function productGridTemplate(slotCount: number, flexible = false, nameColumn = NAME_COLUMN_DEFAULT, terminalColumn = TERMINAL_COLUMN_DEFAULT) {
  const fixed = `40px ${terminalColumn}px ${nameColumn}px ${BOX_COLUMN}px`;
  return `${fixed} repeat(${slotCount}, ${flexible ? `minmax(0, ${PRODUCT_COLUMN_MAX}px)` : 'minmax(130px, 1fr)'})`;
}
// 위 열 정의의 최소 폭 합. 표 전체 폭을 이 값 이상으로 잡아야 옆으로 스크롤해도 헤더·행 배경이 끝까지 이어진다.
const productGridFixedWidth = (nameColumn: number, terminalColumn: number) => 40 + terminalColumn + nameColumn + BOX_COLUMN;
function productGridMinWidth(slotCount: number, nameColumn: number, terminalColumn: number) {
  return productGridFixedWidth(nameColumn, terminalColumn) + slotCount * 130;
}

// 전체보기 위쪽 "품목별 수량" 카드를 접은 상태. 이 브라우저(PC·TV)마다 따로 기억한다 — 서버에는 저장하지 않는다.
const SUMMARY_COLLAPSED_KEY = 'dash-summary-collapsed';
// 툴바 터미널 칩의 [글자 px, 좌우 여백 px] 단계. 첫 단계가 기본이고 한 줄에 안 들어갈 때만 다음 단계로 줄인다.
// PC 등 펜이 없는 기기에서 칠판의 펜 그림을 숨겼는지(이 브라우저에만 저장). 기본은 보인다.
const INK_HIDDEN_KEY = 'board-ink-hidden';
const TOOLBAR_CHIP_STEPS: [number, number][] = [[12, 8], [11, 6], [10, 5], [9, 4]];

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
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ backgroundColor: 'var(--soft-head, #003057)' }}>
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
            className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--soft-head, #003057)' }}
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
  businesses: businessList,
  businessesError = null,
  registered = [],
  onSave,
  onClose,
}: {
  initial?: { businessName: string; terminalId: string | null };
  terminals: Terminal[];
  // 고객사 검색 목록(새 주문 추가에서만 쓴다). 창을 열 때 서버에서 받으므로 처음에는 비어 있을 수 있다: null = 불러오는 중.
  businesses: BusinessDirectoryEntry[] | null;
  businessesError?: string | null;
  // 이 날짜 대시보드에 이미 올라와 있는 (업체, 차수, 터미널) — 새 주문 추가에서 같은 차수·터미널의 중복 등록을 막는다.
  registered?: { businessId: string; round: OrderRound; terminal: string }[];
  // 저장에 실패하면 화면에 보여줄 오류 문구를 돌려준다(성공하면 null).
  onSave: (data: { businessName: string; terminalId: string | null; round: OrderRound }) => Promise<string | null>;
  onClose: () => void;
}) {
  const isEdit = Boolean(initial);
  const businesses = businessList ?? [];
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
              {/* 고객사 목록을 아직 받는 중이거나 받지 못했으면 "일치하는 고객이 없습니다" 대신 그 상태를 알린다(없는 고객으로 오해하지 않게). */}
              {keyword && !matchedBusiness && (businessList === null || businessesError) && (
                <p className="absolute left-0 right-0 top-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs text-slate-600">{businessesError ? `고객사 목록을 불러오지 못했습니다: ${businessesError}` : '고객사 목록을 불러오는 중…'}</p>
              )}
              {keyword && !matchedBusiness && suggestions.length === 0 && businessList !== null && !businessesError && (
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
          <button onClick={handleSave} disabled={!isEdit && !matchedBusiness} className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-40" style={{ backgroundColor: 'var(--soft-head, #003057)' }}>저장</button>
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
  // 수량을 모르는 상품(수량 0·단위 없음 = "수량 미정")은 수정할 때 수량 칸을 비워서 보여준다.
  const wasUndecided = initial?.quantity === 0 && !initial.unit;
  const [quantity, setQuantity] = useState(wasUndecided ? '' : initial?.quantity?.toString() ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [weightKg, setWeightKg] = useState(initial?.secondaryWeightKg?.toString() ?? '');
  const [sizeRequest, setSizeRequest] = useState(initial?.sizeRequest ?? '');
  const [status, setStatus] = useState<ChangeStatus>(initial?.changeStatus ?? 'new');
  const [prep, setPrep] = useState<Prep>(initial?.prep ?? 'none');

  const handleSave = () => {
    if (!productName.trim() || (quantity.trim() && !unit.trim())) return;
    // 수량을 비우면 "수량 미정"(수량 0·단위 없음)으로 저장한다 — 나중에 수정에서 채운다.
    const undecided = !quantity.trim();
    onSave({
      productName: productName.trim(),
      quantity: undecided ? 0 : parseFloat(quantity),
      unit: undecided ? '' : unit.trim(),
      secondaryWeightKg: weightKg.trim() ? parseFloat(weightKg) : null,
      sizeRequest: sizeRequest.trim() || null,
      changeStatus: status,
      prep,
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
            <label className="block text-xs font-bold text-slate-600 mb-1">수량 <span className="text-slate-400 font-normal">(선택)</span></label>
            <input
              type="number" min="0" step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="예) 3"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-bold text-slate-600 mb-1">단위{quantity.trim() ? ' *' : ''}</label>
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
          <label className="block text-xs font-bold text-slate-600 mb-1">포장 방식</label>
          <div className="relative">
            <select
              value={prep}
              onChange={(e) => setPrep(e.target.value as Prep)}
              className="w-full appearance-none border border-slate-300 rounded-lg px-3 pr-9 py-2 text-sm focus:border-[#003057] focus:outline-none"
            >
              <option value="none">일반</option>
              <option value="mulbong">물봉 (물봉 안에 상품을 담음)</option>
              <option value="aerator">기포기 (물봉 + 기포기 부착)</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
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
          <button onClick={handleSave} className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors" style={{ backgroundColor: 'var(--soft-head, #003057)' }}>저장</button>
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
  items: serverItems,
  allTerminals,
  orderDate,
  today,
  productColors,
  unshippedReasons,
  allowPast,
  highlights,
  initialMobile,
}: {
  rows: OrderRow[];
  items: OrderItem[];
  allTerminals: Terminal[];
  orderDate: string;
  today: string;
  productColors: Record<string, { fill: string | null; border: string | null }>;
  unshippedReasons: string[];
  allowPast: boolean;
  highlights: string[];
  initialMobile: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monitorMode = searchParams.get('monitor') || '1';

  // 포장 체크를 서버 응답을 기다리지 않고 바로 보여주기 위한 사본(서버가 새 화면을 보내면 그 값으로 바뀐다).
  // 품목별 수량 팝업에서 고친 수량도 같은 사본에 바로 반영한다(주문 목록의 상품 칸과 품목별 수량이 서버 응답 전에 함께 바뀐다).
  const [items, setOptimisticItem] = useOptimistic(serverItems, (state: OrderItem[], change: { id: string; packed?: boolean; quantity?: number }) =>
    state.map((i) => (i.id === change.id ? { ...i, ...(change.packed !== undefined ? { isPacked: change.packed } : {}), ...(change.quantity !== undefined ? { quantity: change.quantity } : {}) } : i)),
  );

  // 카드별 주문 줄(입력 순서 = productSequence). 행을 그릴 때마다 전체 줄을 다시 훑고 정렬하지 않도록 주문 줄이 바뀔 때만 한 번 묶는다.
  const itemsByDaily = useMemo(() => {
    const map = new Map<string, OrderItem[]>();
    for (const item of items) {
      const list = map.get(item.dailyBusinessId);
      if (list) list.push(item);
      else map.set(item.dailyBusinessId, [item]);
    }
    for (const list of map.values()) list.sort((a, b) => a.productSequence - b.productSequence);
    return map;
  }, [items]);
  const itemsOf = (dailyBusinessId: string): OrderItem[] => itemsByDaily.get(dailyBusinessId) ?? NO_ITEMS;

  // 과거 날짜는 기본적으로 조회 전용 — 실수로 지난 기록을 고치지 않게 편집 수단을 숨긴다.
  // 설정에서 "과거 날짜 편집"을 켜면 오늘과 똑같이 편집할 수 있다.
  const isPast = orderDate !== today;
  // 수정 권한이 없는 계정도 조회 전용이다. 삭제·취소는 별도 권한(dashboard:delete)이다.
  const can = useCan();
  const canDelete = can('dashboard:delete');
  // 칠판 모드 = 플로팅 버튼의 펜이 켜진 동안(별도 스위치 없음, 2026-11-14). 스마트 칠판은 마우스처럼 정교하지 않아 손이 닿을 때마다 포장 체크가 바뀌었으므로
  // 펜이 켜져 있는 동안은 카드 탭을 막고, 펜을 끄면 일반 모드(카드 탭 = 포장 완료)로 돌아간다. 실시간 알림(`board-mode`)과는 따로 둔다.
  // 펜 버튼은 터치 입력이 있는 데스크톱 기기(스마트 칠판)에만 보인다. 주소에 &pen=1이면 강제로 보이고 &pen=0이면 숨긴다(기기 판별이 틀렸을 때 쓰는 우회).
  const [penActive, setPenActive] = useState(false);
  const penAvailable = useTouchDesktop(searchParams.get('pen'));
  const [inkHidden, setInkHidden] = useLocalFlag(INK_HIDDEN_KEY);
  const hydrated = useHydrated(); // 펜 그림 층은 렌더 중 window를 읽으므로 서버에서는 그리지 않는다
  const readOnly = penActive || (isPast && !allowPast) || !can('dashboard:edit');
  const [toastNode, showToast] = useToast();
  const [undoNode, showUndo] = useUndoToast();

  // 칠판 창의 `&sound=off`(그 창만 소리 끔)는 모니터·날짜를 바꿔도 유지한다.
  const soundOffParam = searchParams.get('sound') === 'off' ? '&sound=off' : '';
  // 펜 시험 모드(`&ink=dry`)도 같은 방식으로 유지한다: 동그라미·대각선 인식 결과만 보여 주고 포장 상태는 바꾸지 않는다.
  const inkDry = searchParams.get('ink') === 'dry';
  const dashboardUrl = (mode: string, date: string) =>
    `/dashboard?monitor=${mode}${date === today ? '' : `&date=${date}`}${soundOffParam}${inkDry ? '&ink=dry' : ''}`;
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
  // "새 주문 추가"의 고객사 검색 목록은 창을 열 때마다 서버에서 받는다(그사이 등록된 고객사도 보인다). 받는 동안에는 이전에 받은 목록을 그대로 쓴다.
  const [directory, setDirectory] = useState<{ businesses: BusinessDirectoryEntry[] | null; error: string | null }>({ businesses: null, error: null });
  useEffect(() => {
    if (!addOrderModal) return;
    let cancelled = false;
    void loadBusinessDirectory().then((result) => {
      if (cancelled) return;
      setDirectory((prev) => (result.error ? { businesses: prev.businesses, error: result.error } : { businesses: result.businesses, error: null }));
    });
    return () => {
      cancelled = true;
    };
  }, [addOrderModal]);
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
  // 별도 주문 팝업은 스크롤 없이 주문 목록의 모니터 1·2처럼 모니터(쪽)로 나눠 본다: 행 높이를 재서 팝업 높이에 들어가는 만큼씩 한 쪽에 둔다.
  // 다른 쪽의 행도 화면 밖에 숨겨 둔 채 렌더해서 높이를 재고(펜 그림은 이 행들의 칸을 무시한다), 쪽마다 그림을 따로 저장한다(monitor s1·s2…).
  const [sepPage, setSepPage] = useState(0);
  const [sepHeights, setSepHeights] = useState<Record<string, number>>({});
  const sepListRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight));
  // 표 모양이라 행 사이 간격은 없고(테두리만), 표 머리 줄 높이만큼 쓸 수 있는 높이에서 뺀다.
  const SEP_ROW_GAP = 0;
  const SEP_HEADER_H = 30;
  const sepAvail = Math.max(0, Math.floor(viewportHeight * 0.88) - 88 - SEP_HEADER_H);
  // 모니터 1에 조금만 넘치는데 모니터 2로 넘기지 않도록, 먼저 행 여백을 한 단계씩 줄여서 한 쪽에 들어가는지 본다(글자 크기는 그대로).
  // 끝까지 줄여도 안 들어갈 때만 쪽을 나눈다. 단계는 팝업을 열거나 주문·창 높이가 바뀌면 처음(넉넉함)부터 다시 정한다.
  const [sepFit, setSepFit] = useState({ key: '', level: 0 });
  useLayoutEffect(() => {
    if (!separateOpen) return;
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [separateOpen]);
  // 별도 주문 행·상품 수나 창 높이가 바뀌면 촘촘함 단계를 처음으로 되돌린다(줄어든 주문에서 계속 촘촘하게 남지 않도록). 팝업을 열 때도 처음부터(버튼에서 비운다).
  const sepFitKey = `${separateRows.length}:${separateRows.reduce((sum, r) => sum + itemsOf(r.dailyBusinessId).length, 0)}:${viewportHeight}`;
  const sepDensity = sepFit.key === sepFitKey ? sepFit.level : 0;
  // 별도 주문 팝업이 떠 있는 동안 뒤의 화면(주문 목록을 감싼 컨테이너들)이 스크롤되지 않게 한다.
  // 이 컨테이너들은 overflow가 hidden이라 사용자는 스크롤할 수 없지만, 팝업 안 스크롤이 끝에서 뒤로 번지거나(스크롤 연쇄) 브라우저가
  // 포커스·선택 때문에 코드로 스크롤해 버리면 화면이 아래로 밀린 채 되돌릴 수 없게 된다(2026-11-14 현장: 메뉴를 펼쳐 위로 올려야 풀렸다).
  // 스크롤이 생기면 바로 0으로 되돌리고, 팝업을 닫을 때도 한 번 되돌린다. 모바일은 이 팝업이 없다.
  useEffect(() => {
    if (!separateOpen) return;
    const holders: HTMLElement[] = [];
    for (let el = document.querySelector<HTMLElement>('main.main-content'); el && el !== document.body; el = el.parentElement) holders.push(el);
    const reset = () => {
      for (const el of holders) {
        if (el.scrollTop !== 0) el.scrollTop = 0;
        if (el.scrollLeft !== 0) el.scrollLeft = 0;
      }
    };
    for (const el of holders) el.addEventListener('scroll', reset, { passive: true });
    return () => {
      for (const el of holders) el.removeEventListener('scroll', reset);
      reset();
    };
  }, [separateOpen]);
  // 행 높이 측정: 렌더 뒤마다 재서 달라졌을 때만 상태를 바꾼다(같으면 다시 그리지 않는다).
  useLayoutEffect(() => {
    if (!separateOpen) return;
    const measure = () => {
      const list = sepListRef.current;
      if (!list) return;
      const next: Record<string, number> = {};
      list.querySelectorAll<HTMLElement>('[data-sep-row]').forEach((el) => {
        next[el.dataset.sepRow as string] = Math.ceil(el.getBoundingClientRect().height);
      });
      setSepHeights((prev) => {
        const keys = Object.keys(next);
        return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
      });
      // 방금 잰 높이로 한 쪽에 다 들어가는지 본다. 안 들어가고 더 줄일 수 있으면 한 단계 더 촘촘하게(다음 렌더에서 다시 잰다).
      const heights = separateRows.map((r) => next[r.dailyBusinessId] ?? 56);
      if (packRows(heights, sepAvail, SEP_ROW_GAP).length > 1 && sepDensity < SEP_DENSITIES.length - 1) setSepFit({ key: sepFitKey, level: sepDensity + 1 });
    };
    measure();
    void document.fonts?.ready.then(measure);
  });
  // 품목별 수량은 일반 주문과 별도 주문(택배·직배송 등)을 나눠 센다 — 기본 화면에는 일반 주문 상품만, 별도 주문 상품은 팝업에서 본다.
  // 주문 줄이나 별도 주문 카드 구성이 바뀔 때만 다시 센다(메뉴를 여닫는 등 무관한 다시 그리기에서는 다시 세지 않는다).
  const separateKey = separateRows.map((r) => r.dailyBusinessId).join('|');
  const { mainItems, separateItems, columns, separateColumns } = useMemo(() => {
    const separateDailyIds = new Set(separateKey ? separateKey.split('|') : []);
    const main = items.filter((i) => !separateDailyIds.has(i.dailyBusinessId));
    const separate = items.filter((i) => separateDailyIds.has(i.dailyBusinessId));
    return { mainItems: main, separateItems: separate, columns: getProductSummary(main), separateColumns: getProductSummary(separate) };
  }, [items, separateKey]);
  // 별도 주문 팝업의 쪽 나누기: 팝업이 쓸 수 있는 높이(화면의 88% − 제목 줄 − 안쪽 여백)에 들어가는 만큼씩.
  const sepPages = packRows(separateRows.map((r) => sepHeights[r.dailyBusinessId] ?? 56), sepAvail, SEP_ROW_GAP);
  // 상품 열 수는 별도 주문 행 중 상품이 가장 많은 업체 기준(쪽을 넘겨도 열이 바뀌지 않게 모든 행에서 센다).
  const sepSlotCount = Math.max(1, ...separateRows.map((r) => itemsOf(r.dailyBusinessId).length));
  const sepGridTemplate = `44px 76px minmax(150px, 1.3fr) 64px repeat(${sepSlotCount}, minmax(104px, 1fr))`;
  const sepMinWidth = 44 + 76 + 150 + 64 + sepSlotCount * 104;
  const sepPageNo = Math.min(sepPage, sepPages.length - 1);
  const sepVisible = new Set(sepPages[sepPageNo].map((i) => separateRows[i].dailyBusinessId));
  // 터미널별 박스는 기본 주문표 기준이다 — 별도 주문 터미널은 "별도 주문" 팝업에서 따로 본다.
  // 주문이 모두 취소된 고객사의 박스는 터미널별 박스 수에 세지 않는다.
  const cancelledCardSet = new Set(mainRows.filter((r) => isCardCancelled(itemsOf(r.dailyBusinessId))).map((r) => r.dailyBusinessId));
  const terminalBoxTotals = getTerminalBoxTotals(mainRows.filter((r) => !cancelledCardSet.has(r.dailyBusinessId)));

  // 표의 상품 열은 더 이상 "오늘 등록된 품목 종류"(columns) 기준이 아니라 "업체 한 곳이
  // 가장 많이 주문한 상품 수 + 1"(마지막은 항상 추가 버튼) 기준이다 — 열 개수가 품목 종류
  // 수에 비례하던 예전 방식은 품목이 늘어날수록 표가 한없이 넓어져 가로 스크롤이 생겼다.

  // 모바일(휴대폰)은 화면이 하나뿐이라 모니터 1/2로 나누는 게 의미가 없다 — 항상 전체보기로
  // 강제한다. 서버 렌더 시점엔 뷰포트를 알 수 없어 기본값(false)으로 그리고 마운트 후
  // matchMedia로 판정해 갱신한다(사이드바 접힘과 같은 패턴 — AGENTS.md 알려진 이슈 참고).
  const isMobile = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(max-width: 768px)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(max-width: 768px)').matches,
    () => initialMobile, // 서버는 요청한 기기로 판단한 값을 쓴다 — 폰에서 PC 화면이 한 번 비쳤다 바뀌는 깜빡임을 막는다
  );

  const effectiveMonitorMode = isMobile ? 'all' : monitorMode;
  const isSplitMode = effectiveMonitorMode !== 'all';
  // 이 기기가 칠판 펜으로 그릴 수 있는지. 아니면(PC 등) 같은 그림을 읽기 전용으로 본다.
  const inkWriter = penAvailable && isSplitMode && can('dashboard:edit') && !(isPast && !allowPast);
  // 별도 주문 팝업은 모니터 1·2와 달리 분할 모드 조건이 없다(팝업 자체가 하나의 화면).
  const inkWriterPopup = penAvailable && can('dashboard:edit') && !(isPast && !allowPast);
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

  // 터미널 열 폭: 가장 긴 터미널 이름 칩을 한 줄로 그릴 수 있는 폭. 칩 좌우 여백(px-2 = 16) + 칩 테두리 2 + 칸 좌우 여백(px-2 = 16) + 오른쪽 경계선·반올림 여유.
  const [terminalColumn, setTerminalColumn] = useState(TERMINAL_COLUMN_DEFAULT);
  const terminalSignature = [...new Set(rows.map((r) => r.terminal || '-'))].join('\n');
  useLayoutEffect(() => {
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `700 11px ${getComputedStyle(document.body).fontFamily}`;
      const widest = terminalSignature.split('\n').reduce((max, name) => Math.max(max, ctx.measureText(name).width), 0);
      setTerminalColumn(Math.min(TERMINAL_COLUMN_MAX, Math.max(TERMINAL_COLUMN_MIN, Math.ceil(widest) + 38)));
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, [terminalSignature]);

  // 고객명 열 폭: 가장 긴 고객명(굵은 12px)을 한 줄로 그릴 수 있는 폭. 1·2차 배지가 붙는 고객은 배지 폭만큼 더한다.
  // 완료 배지는 상태에 따라 붙었다 떨어지므로 열 폭에 넣지 않는다(폭이 흔들리지 않게). 넘치면 2줄로 접힌다. "박스 재확인" 경고는 고객명 칸이 아니라 박스 칸에 붙는다.
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

  const tierHeight =
    availHeight > 0
      ? ROW_HEIGHT_TIERS.find((h) => MONITOR_COUNT * Math.floor(availHeight / h) >= rows.length) ?? MIN_ROW_HEIGHT
      : ROW_HEIGHT_TIERS[0];
  // 단계 높이로 나누고 남는 자투리가 하단의 어정쩡한 빈 공간이 되지 않게, 행을 조금(6px 이하) 줄여서 한 행을 더 넣을 수 있으면 넣는다(2026-11-14 현장 요청).
  const fitted = availHeight > 0 ? fitRowHeight(availHeight, tierHeight, MIN_ROW_HEIGHT, ROW_FIT_MAX_SHRINK) : { rowHeight: tierHeight, capacity: INITIAL_ROW_CAPACITY };
  const rowHeight = fitted.rowHeight;
  const ownCapacity = fitted.capacity;
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
    });
  };
  // 휴대폰 화면에서 카드를 끌어 바꾼 순서: 구분(기본/별도) 안의 새 순서를 전체 순서의 그 구분 자리에 끼워 넣는다(다른 구분 카드는 제자리).
  const handleMobileReorder = (segment: 'main' | 'separate', segmentIds: string[]) => {
    let cursor = 0;
    const orderedIds = allRows.map((r) => (separateNames.has(r.terminal) === (segment === 'separate') ? segmentIds[cursor++] : r.dailyBusinessId));
    startReorder(async () => {
      setOptimisticOrder(orderedIds);
      await reorderDailyBusinesses(orderedIds);
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
  // 크기는 가장 큰 크기부터 1px씩 줄인 단계를 준비하고, 어느 단계가 필요한지는 그려진 결과(넘침)를 보고 아래 효과에서 팁마다 정한다.
  // 팁 안쪽 높이 = 행 높이 − 테두리 1 − 칸 여백 2 − 팁 테두리 2. (칸 여백을 4 → 2px로 줄여 글자를 키웠다, 2026-11-14 현장 요청)
  const pillInnerHeight = rowHeight - 5;

  // 열 개수는 "이 화면에 실제로 보이는 행" 중 상품이 가장 많은 업체 기준 + 1(추가 버튼 열)이다.
  // 모니터마다 다른 업체가 보이므로 전체 기준이 아니라 화면에 표시되는 행 기준으로 센다.
  const maxProductCount = displayedRows.reduce((max, row) => {
    const count = itemsOf(row.dailyBusinessId).length;
    return Math.max(max, count);
  }, 0);
  const productSlotCount = Math.max(1, maxProductCount);
  const gridTemplate = productGridTemplate(productSlotCount, isSplitMode, nameColumn, terminalColumn);
  // 모니터 1/2는 열 폭이 화면 폭으로 정해진다. 상품이 많아 열이 좁아지면 글자도 그만큼 줄인다.
  const colWidth = isSplitMode && availWidth > 0 ? (availWidth - productGridFixedWidth(nameColumn, terminalColumn)) / productSlotCount : Infinity;
  const widthShrink = colWidth >= 120 ? 0 : colWidth >= 100 ? 1 : colWidth >= 88 ? 2 : 3;
  // 글자 크기 단계: 가장 큰 크기부터 1px씩 줄여 가며, 팁 안쪽 높이에 들어가는 가장 큰 크기를 팁마다 고른다(아래 효과).
  // 한 줄에 들어가면 한 줄로, 안 들어가면 두 줄이 팁 안에 들어가는 크기까지 줄인다. 괄호 표기(사이즈·물봉 등)가 붙은 팁도
  // 같은 규칙이라, 팁에 여백이 있으면 그만큼 크게 보인다. 수량이 품목명·단위보다 크고, 작은 크기에서는 둘이 비슷해진다.
  // 괄호 표기(옵션: "(키로5-6미, 기포기)")는 품목명보다 작게 시작하고, 칩이 넘치면 품목명보다 먼저 7px까지 줄인다.
  // 품목명·수량은 옵션이 최소 크기가 된 뒤에야 줄어든다(옵션 때문에 품목명이 작아 보이지 않게).
  const pillSteps = (() => {
    const nameSizeOf = (q: number) => Math.max(6, q >= 13 ? q - 3 : q - 1);
    let q = Math.max(7, 15 - widthShrink);
    let o = Math.max(7, nameSizeOf(q) - 2);
    const steps: { q: number; f: number; o: number; lh: number }[] = [];
    for (;;) {
      const f = nameSizeOf(q);
      steps.push({ q, f, o: Math.min(o, f), lh: q <= 8 ? 1.0 : 1.15 });
      if (o > 7) o -= 1;
      else if (q > 7) q -= 1;
      else break;
    }
    return steps;
  })();
  const pillStepsAttr = pillSteps.map((p) => `${p.q},${p.f},${p.lh},${p.o}`).join('|');

  // 웹폰트가 늦게 로드되면 글자 폭이 달라져 줄바꿈이 바뀐다. 로드가 끝나면 모든 팁을 한 번 다시 맞춘다.
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) setFontEpoch(1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 팁마다 글자 크기 단계를 정한다: 기본 단계부터 시작해, 팁 안쪽 높이를 넘치면 한 단계씩 줄인다.
  // 이 효과는 그릴 때마다 돌지만, 팁마다 "맞출 때의 조건"(내용·크기 단계·안쪽 높이·폭·글꼴 로드)을 기억해 두고 조건이 그대로인 팁은 건너뛴다.
  // 예전에는 메뉴를 여닫거나 실시간 갱신이 올 때마다 모든 팁의 글자 크기를 다시 쓰고 높이를 다시 재서(쓰기·읽기가 번갈아 일어나 팁 수만큼 레이아웃을 다시 계산)
  // 칠판처럼 팁이 많은 화면이 무거웠다(2026-11-14). 조건은 먼저 한꺼번에 읽고(쓰기 없음), 바뀐 팁만 다시 맞춘다.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const dirty: { el: HTMLElement; key: string }[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('[data-pill]')) {
      const key = `${el.innerHTML}|${el.dataset.sizes ?? ''}|${pillInnerHeight}|${el.clientWidth}|${fontEpoch}`;
      if (el.dataset.fitKey !== key) dirty.push({ el, key });
    }
    for (const { el, key } of dirty) {
      const steps = (el.dataset.sizes ?? '').split('|').map((p) => p.split(','));
      let step = 0;
      const apply = (n: number) => {
        el.style.setProperty('--pq', `${steps[n][0]}px`);
        el.style.setProperty('--pn', `${steps[n][1]}px`);
        el.style.setProperty('--pl', steps[n][2]);
        el.style.setProperty('--po', `${steps[n][3]}px`);
      };
      el.style.setProperty('--pshift', '0px');
      apply(step);
      while (el.scrollHeight > pillInnerHeight - 3 && step < steps.length - 1) apply(++step);
      // 옵션이 둘째 줄로 내려간 칩은 첫 줄의 큰 수량과 둘째 줄의 작은 옵션의 글자 상자 차이 때문에 글자가 칩 가운데보다 0.5~0.7px 위에 놓인다
      // (옵션이 7px까지 작아지면서 세로 중앙 점검에서 위·아래 여백이 1.1px 어긋났다, 2026-11-14). 크기가 정해진 뒤에 그만큼만 내려 맞춘다.
      const option = el.querySelector<HTMLElement>('[data-pill-opt]');
      const firstItem = el.firstElementChild;
      // 같은 줄이면 옵션의 윗선이 첫 항목(품목명)의 아랫선보다 위에 있다(기준선 정렬이라 글자 크기가 달라도 겹친다). 둘째 줄이면 그 아래에서 시작한다.
      if (option && firstItem instanceof HTMLElement && option.offsetTop >= firstItem.offsetTop + firstItem.offsetHeight - 1) el.style.setProperty('--pshift', '0.6px');
      el.dataset.fitKey = key;
    }
  });

  // 툴바는 무조건 한 줄이다(두 줄로 꺾이면 그만큼 표의 행을 잃는다). 터미널별 박스 수 칩이 남는 폭에 안 들어가면 글자·여백을 단계적으로 줄이고,
  // 그래도 안 들어가면 칩 줄 안에서만 가로로 밀어 볼 수 있다. 크기는 CSS 변수로만 바꿔서 칩을 다시 그리지 않는다.
  const chipRowRef = useRef<HTMLDivElement>(null);
  const chipSignature = terminalBoxTotals.map((t) => `${t.terminal}:${t.boxes}`).join('|');
  useLayoutEffect(() => {
    const el = chipRowRef.current;
    if (!el) return;
    const fit = () => {
      for (const [fs, px] of TOOLBAR_CHIP_STEPS) {
        el.style.setProperty('--tb-fs', `${fs}px`);
        el.style.setProperty('--tb-px', `${px}px`);
        if (el.scrollWidth <= el.clientWidth + 1) break;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [chipSignature]);
  const [monitorMenuOpen, setMonitorMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  // 별도 주문(택배) 고객의 정산용 엑셀(.xlsx)을 내려받는다. 양식은 src/lib/export/settlement.ts. 엑셀 라이브러리는 클릭할 때만 불러온다.
  const [exporting, setExporting] = useState(false);
  const exportOrders = async () => {
    if (exporting) return;
    if (separateRows.length === 0) {
      window.alert('내려받을 별도 주문(택배) 고객이 없습니다. 터미널 관리에서 별도 주문으로 지정한 터미널의 주문이 이 파일에 담깁니다.');
      return;
    }
    setExporting(true);
    try {
      const { buildSettlementLines, buildSettlementWorkbook } = await import('@/lib/export/settlement');
      const blob = await buildSettlementWorkbook(buildSettlementLines(separateRows, items, orderDate), orderDate);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `정산_${orderDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

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
    });
  const clearHl = () =>
    startHlTransition(async () => {
      setHlOptimistic({ name: null, on: false });
      await clearProductHighlights(orderDate);
    });

  // 포장 체크는 누르는 즉시 화면에 반영하고 저장은 뒤에서 한다(서버가 응답과 함께 최신 화면을 돌려준다).
  const [, startPackedTransition] = useTransition();
  const handleTogglePacked = (item: OrderItem) => {
    if (item.changeStatus === 'cancelled') return;
    startPackedTransition(async () => {
      setOptimisticItem({ id: item.id, packed: !item.isPacked });
      const { error } = await togglePacked(item.id, !item.isPacked);
      if (error) showToast(error);
    });
  };
  // 펜(동그라미·대각선)이 포장 완료로 올리거나 되돌리기가 해제할 때 쓴다. 이미 원하는 상태이거나 취소된 상품이면 아무것도 하지 않는다.
  const handleSetPacked = (itemId: string, packed: boolean) => {
    const item = items.find((i) => i.id === itemId);
    if (!item || item.changeStatus === 'cancelled' || item.isPacked === packed) return;
    handleTogglePacked(item);
  };
  // 품목별 수량 팝업에서 한 고객의 이 품목 줄들을 한 번에 포장 완료로 켜거나 끈다(이미 그 상태이거나 취소된 줄은 건너뛴다).
  const handleSetPackedMany = (lineIds: string[], packed: boolean) => {
    for (const id of lineIds) handleSetPacked(id, packed);
  };
  // 팝업에서 수량을 바꾼다. 주문 수정과 같은 저장(updateOrderItemManual)이라 수정 표시·미출고 수량 보정도 같다.
  const handleChangeQuantity = (itemId: string, quantity: number) => {
    const item = items.find((i) => i.id === itemId);
    if (!item || readOnly || item.quantity === quantity) return;
    startPackedTransition(async () => {
      setOptimisticItem({ id: item.id, quantity });
      const { error } = await updateOrderItemManual(item.id, {
        productName: item.productName,
        quantity,
        unit: item.unit,
        secondaryWeightKg: item.secondaryWeightKg ?? null,
        sizeRequest: item.sizeRequest ?? null,
        changeStatus: item.changeStatus,
        prep: prepOf(item),
      });
      if (error) showToast(error);
    });
  };
  // 펜 그림 층이 상품 칸을 판정할 때 쓰는 최소 정보(상품 id·포장 여부·취소 여부·시험 모드에 보일 이름).
  const inkItems = useMemo<InkItem[]>(
    () => items.map((i) => ({ id: i.id, isPacked: i.isPacked, cancelled: i.changeStatus === 'cancelled', label: `${i.businessName} ${i.productName}` })),
    [items],
  );

  // 취소는 확인 없이 바로 실행하되, 바로 뒤에 "되돌리기"를 보여 준다(오클릭 대비). 되돌리면 취소하기 전 상태로 돌아간다.
  const handleCancelItem = async (item: OrderItem) => {
    const previous = item.changeStatus;
    const { error } = await cancelOrderItem(item.id);
    if (error) return showToast(error);
    if (previous === 'cancelled') return;
    showUndo(`${item.businessName} ${item.productName} 주문을 취소했습니다`, async () => {
      const result = await restoreOrderItem(item.id, previous);
      if (result.error) showToast(result.error);
    });
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
    return null;
  };

  const handleSaveItem = async (fields: ManualItemFields) => {
    if (editItemModal) {
      const { error } = await updateOrderItemManual(editItemModal.id, fields);
      if (error) return showToast(error);
      setEditItemModal(null);
    } else if (addItemModal) {
      const { error } = await addOrderItemManual(addItemModal.row.dailyBusinessId, fields);
      if (error) return showToast(error);
      setAddItemModal(null);
    }
  };

  // 품목별 수량: 모니터 2는 오른쪽 세로 패널, 전체보기(모바일 포함)는 표 위 카드로 보여준다.
  const chipStyle = (name: string): React.CSSProperties => {
    const c = resolveColors(productColors[name]?.fill, productColors[name]?.border);
    return { backgroundColor: c.fill, borderColor: c.border, color: c.text, filter: 'saturate(0.75) brightness(0.96)' }; // 밝은 파스텔이 눈부시지 않게 채도·밝기를 낮춘다
  };
  // 상품 칩을 누르면 그 옆에 이 상품을 주문한 고객사 목록(플로팅)을 연다. 목록은 매번 최신 items로 계산한다.
  const [customerPanel, setCustomerPanel] = useState<{ dailyBusinessId: string; anchor: { left: number; top: number; right: number; bottom: number } } | null>(null);
  const openCustomerPanel = (dailyBusinessId: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setCustomerPanel({ dailyBusinessId, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  };
  // 박스 열을 누르면 그 업체의 박스 할당 팝업을 연다(박스 할당 보기 권한이 있고 펜이 꺼져 있을 때). 제출·고치기 권한은 팝업 안에서 따로 확인한다.
  const [boxModal, setBoxModal] = useState<{ dailyBusinessId: string; title: string } | null>(null);
  const canOpenBox = can('packing:view') && !penActive;
  const closeBoxModal = useCallback(() => setBoxModal(null), []);
  const closeCustomerPanel = useCallback(() => setCustomerPanel(null), []);
  const [picked, setPicked] = useState<{ scope: 'main' | 'separate'; productKey: string; anchor: { left: number; top: number; right: number; bottom: number } } | null>(null);
  const pickProduct = (scope: 'main' | 'separate', product: ProductSummaryRow, rect: DOMRect) => {
    setPicked({ scope, productKey: product.key, anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } });
  };
  const pickedProduct = picked ? (picked.scope === 'main' ? columns : separateColumns).find((c) => c.key === picked.productKey) : undefined;
  const closePicked = useCallback(() => setPicked(null), []);
  const renderChips = (list: typeof columns) => list.map((product) => (
    <div
      key={product.key}
      role="button"
      tabIndex={0}
      title="누르면 이 상품을 주문한 고객사를 봅니다"
      onClick={(e) => pickProduct('main', product, e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickProduct('main', product, e.currentTarget.getBoundingClientRect()))}
      className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 cursor-pointer"
      style={chipStyle(product.productName)}
    >
      <span className="text-xs font-bold">{product.label}</span>
      {product.undecided > 0 ? (
        <span className="text-xs font-black text-amber-700 bg-amber-100 rounded px-1" title="주문에서 수량을 못 찾은 상품입니다. 주문을 수정해서 수량을 채워 주세요">미정 {product.undecided}곳</span>
      ) : (
        <>
          <span className="text-xs font-black">{product.total}{product.unit}</span>
          {productDelta(product) !== 0 && <span className="text-[10px] font-bold text-sky-700 bg-white/70 rounded px-1" title={DELTA_TITLE}>{formatDelta(productDelta(product), product.unit)}</span>}
          {product.unshipped > 0 && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded px-1">미출고 {product.unshipped}</span>}
        </>
      )}
    </div>
  ));
  const productChips = renderChips(columns);
  const [summaryCollapsed, setSummaryCollapsed] = useLocalFlag(SUMMARY_COLLAPSED_KEY);
  // 접기 버튼은 카드 아래 가장자리 오른쪽에 반쯤 걸쳐 두어(엑셀의 그룹 접기 단추처럼) 자리를 따로 차지하지 않는다.
  const summaryCard = (
    <div className="relative flex-shrink-0">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid var(--soft-brass, #003057)' }}>
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

  const productPanel = <ProductSummaryPanel columns={columns} chipStyle={chipStyle} availHeight={availHeight} onPick={(p, r) => pickProduct('main', p, r)} />;

  // 모달·확인창은 PC와 휴대폰 화면이 같이 쓴다.
  // 고객명을 누르면 그 옆에 이 고객의 주문 편집 패널(상품 추가·수정·미출고·취소·삭제, 주문 수정·삭제)을 연다. 행·상품은 매번 최신 값으로 다시 찾는다.
  const panelRow = customerPanel ? allRows.find((r) => r.dailyBusinessId === customerPanel.dailyBusinessId) : undefined;
  // 모달을 여는 동작은 패널을 먼저 닫는다(모달이 패널 뒤로 가려지지 않게). 취소는 바로 실행되므로 패널을 열어 둔 채 결과를 보여 준다.
  const fromPanel = (fn: () => void) => () => {
    setCustomerPanel(null);
    fn();
  };
  const pickedCustomers = picked && pickedProduct
    ? getProductCustomers(picked.scope === 'main' ? mainItems : separateItems, pickedProduct, new Map((picked.scope === 'main' ? mainRows : separateRows).map((r, index) => [r.dailyBusinessId, index])))
    : [];
  const overlays = (
    <>
      {toastNode}
      {undoNode}
      {boxModal && <BoxAssignModal key={boxModal.dailyBusinessId} dailyBusinessId={boxModal.dailyBusinessId} title={boxModal.title} onClose={closeBoxModal} />}
      {customerPanel && panelRow && (
        <CustomerOrderPanel
          row={panelRow}
          items={itemsOf(panelRow.dailyBusinessId)}
          anchor={customerPanel.anchor}
          canDelete={canDelete}
          onClose={closeCustomerPanel}
          onAddItem={fromPanel(() => setAddItemModal({ row: panelRow }))}
          onEditOrder={fromPanel(() => setEditOrderModal(panelRow))}
          onDeleteOrder={fromPanel(() => setConfirmDelete({ type: 'order', dailyBusinessId: panelRow.dailyBusinessId }))}
          onEditItem={(item) => fromPanel(() => setEditItemModal(item))()}
          onUnshipped={(item) => fromPanel(() => setUnshippedModal(item))()}
          onCancelItem={(item) => void handleCancelItem(item)}
          onDeleteItem={(item) => fromPanel(() => setConfirmDelete({ type: 'item', itemId: item.id }))()}
        />
      )}
      {picked && pickedProduct && <ProductCustomersPopover product={pickedProduct} customers={pickedCustomers} anchor={picked.anchor} chipStyle={chipStyle(pickedProduct.productName)} canEdit={!readOnly} onSetPacked={handleSetPackedMany} onChangeQuantity={handleChangeQuantity} onClose={closePicked} />}
      {addOrderModal && (
        <OrderFormModal terminals={allTerminals} businesses={directory.businesses} businessesError={directory.error} registered={allRows.map((r) => ({ businessId: r.businessId, round: r.round, terminal: r.terminal }))} onSave={handleSaveOrder} onClose={() => setAddOrderModal(false)} />
      )}
      {editOrderModal && (
        <OrderFormModal
          initial={{
            businessName: editOrderModal.businessName,
            terminalId: allTerminals.find((t) => t.name === editOrderModal.terminal)?.id ?? null,
          }}
          terminals={allTerminals}
          businesses={[]}
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
            prep: prepOf(editItemModal),
          }}
          onSave={handleSaveItem}
          onClose={() => setEditItemModal(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          message={
            confirmDelete.type === 'order'
              ? '이 날짜의 주문을 완전히 삭제하시겠습니까? 등록된 상품도 모두 함께 삭제됩니다. (고객사 관리의 고객사는 삭제되지 않습니다.)'
              : '이 상품을 주문에서 삭제하시겠습니까? 취소 상태로만 변경하려면 "×" 버튼을 이용하세요.'
          }
          onConfirm={async () => {
            const result =
              confirmDelete.type === 'order' && confirmDelete.dailyBusinessId
                ? await deleteDailyBusiness(confirmDelete.dailyBusinessId)
                : confirmDelete.itemId
                  ? await deleteOrderItem(confirmDelete.itemId)
                  : null;
            if (result?.error) showToast(result.error);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        <DashboardMobile
          orderDate={orderDate}
          today={today}
          mainRows={mainRows}
          separateRows={separateRows}
          items={items}
          terminalColors={terminalColors}
          roundOf={roundOf}
          readOnly={readOnly}
          canDelete={canDelete}
          onSetDate={setDate}
          onTogglePacked={handleTogglePacked}
          onEditItem={setEditItemModal}
          onAddItem={(row) => setAddItemModal({ row })}
          onUnshipped={setUnshippedModal}
          onCancelItem={(item) => void handleCancelItem(item)}
          onDeleteItem={(item) => setConfirmDelete({ type: 'item', itemId: item.id })}
          onEditOrder={(row) => setEditOrderModal(row)}
          onDeleteOrder={(row) => setConfirmDelete({ type: 'order', dailyBusinessId: row.dailyBusinessId })}
          onReorder={handleMobileReorder}
          onAddOrder={() => setAddOrderModal(true)}
        />
        {overlays}
      </>
    );
  }

  return (
    // 대시보드 페이지의 여백 자체는 dashboard-shell.tsx의 .main-content-tight가 담당한다
    // (12px/16px) — 여기서 음수 마진으로 상쇄하는 방식은 main-content의 overflow-y:auto가
    // overflow-x까지 auto로 끌어올리는 CSS 규칙과 부딪혀 표 오른쪽이 잘려 보이는 버그가 있었다.
    <div className="flex flex-col h-[calc(100vh-24px)] gap-2">
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm flex-shrink-0 flex-nowrap">
        <div className="flex gap-2 items-center flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => shiftDate(-1)} className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center justify-center" title="전날"><ChevronLeft className="w-4 h-4" /></button>
            {/* 날짜 글자만 보이고(달력 아이콘 없음), 같은 크기의 투명한 날짜 입력칸이 겹쳐 있어 누르면 달력이 뜬다. */}
            <span className="relative inline-flex items-center justify-center text-sm font-bold text-slate-800 border border-slate-200 rounded-md px-2 py-1 bg-white focus-within:border-[#003057]">
              <span className="tabular-nums whitespace-nowrap" aria-hidden>{orderDate.replaceAll('-', '.')}</span>
              <input
                type="date"
                value={orderDate}
                max={today}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker();
                  } catch {
                    // 지원하지 않는 브라우저는 입력칸을 직접 편집한다
                  }
                }}
                aria-label="날짜"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </span>
            <button onClick={() => shiftDate(1)} disabled={orderDate >= today} className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center" title="다음날"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="w-px h-4 bg-slate-200 flex-shrink-0" />
          <div ref={chipRowRef} className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {terminalBoxTotals.map(({ terminal, boxes }) => (
              <div
                key={terminal}
                className={`flex items-center gap-1 flex-shrink-0 rounded-md border font-bold ${terminalBadgeProps(terminal, terminalColors).className}`}
                style={{ ...terminalBadgeProps(terminal, terminalColors).style, fontSize: 'var(--tb-fs, 12px)', padding: '2px var(--tb-px, 8px)' }}
              >
                <span>{terminal || '(터미널 없음)'}</span>
                <span className="font-black">{boxes}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* 실시간 알림 컨트롤(켜기·상태·소리·변경 목록). 화면에 떠 있으면 표의 맨 아래 행을 가려서 툴바 안에 둔다. */}
          <DashboardSound key={orderDate} rows={rawRows} items={serverItems} orderDate={orderDate} />
          {/* 모바일은 화면이 하나뿐이라 모니터 분할 자체가 의미 없다 — 전체보기만 강제되므로 */}
          {/* 선택 버튼도 노출하지 않는다(md 이상, 768px부터 노출 — 위 isMobile 판정 기준과 동일). */}
          {/* 모니터 설정(전체보기·모니터 1·모니터 2)은 버튼 하나에 현재 모드를 보여 주고, 누르면 선택 메뉴가 떠서 툴바 폭을 아낀다. */}
          <div className="relative hidden md:block">
            <button
              onClick={() => setMonitorMenuOpen((v) => !v)}
              className="h-8 px-2 inline-flex items-center gap-1 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
              title="모니터 설정 (전체보기·모니터 1·모니터 2)"
              aria-label="모니터 설정"
              aria-haspopup="menu"
              aria-expanded={monitorMenuOpen}
            >
              {monitorMode === 'all' ? <LayoutGrid className="w-4 h-4" /> : <><Monitor className="w-4 h-4" /><span>{monitorMode}</span></>}
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
            {monitorMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMonitorMenuOpen(false)} />
                <div role="menu" aria-label="모니터 설정" className="absolute right-0 top-10 z-50 w-44 rounded-xl bg-white shadow-lg border border-slate-200 p-1.5">
                  {([
                    { mode: 'all', title: '전체보기', icon: <LayoutGrid className="w-4 h-4" /> },
                    { mode: '1', title: '모니터 1', icon: <Monitor className="w-4 h-4" /> },
                    { mode: '2', title: '모니터 2', icon: <Monitor className="w-4 h-4" /> },
                  ] as const).map(({ mode, title, icon }) => (
                    <button
                      key={mode}
                      role="menuitemradio"
                      aria-checked={monitorMode === mode}
                      onClick={() => {
                        setMonitorMode(mode);
                        setMonitorMenuOpen(false);
                      }}
                      className={`w-full h-11 px-3 flex items-center gap-2 rounded-lg text-sm font-bold text-left transition-colors ${monitorMode === mode ? 'bg-slate-100 text-[#003057]' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                      {icon}
                      <span className="flex-1">{title}</span>
                      {monitorMode === mode && <Check className="w-4 h-4" strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {separateNames.size > 0 && (
            <button
              onClick={() => { setSepPage(0); setSepFit({ key: '', level: 0 }); setSeparateOpen(true); }}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-bold rounded-lg border transition-colors bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
              title={`별도 주문 보기 (택배·직배송 등) — ${separateRows.length}건`}
              aria-label="별도 주문 보기"
            >
              <Truck className="w-4 h-4" />
              {separateRows.length}
            </button>
          )}
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
          {/* 칠판 펜 그림 보기/숨기기: 펜을 쓰지 않는 기기(PC)에서만. 그림이 표를 가릴 때 끌 수 있다. */}
          {isSplitMode && !inkWriter && (
            <button
              onClick={() => setInkHidden(!inkHidden)}
              className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors ${inkHidden ? 'border-slate-200 text-slate-400 bg-white hover:bg-slate-100' : 'bg-[#003057] border-[#003057] text-white hover:opacity-90'}`}
              title={inkHidden ? '칠판 펜 그림 보기' : '칠판 펜 그림 숨기기'}
              aria-label={inkHidden ? '칠판 펜 그림 보기' : '칠판 펜 그림 숨기기'}
              aria-pressed={!inkHidden}
            >
              <PenLine className="w-4 h-4" />
            </button>
          )}
          {/* 주문 추가와 엑셀 다운로드는 버튼 하나에서 고른다(보기 전용이면 다운로드만 나온다). */}
          <div className="relative">
            <button
              onClick={() => setActionMenuOpen((v) => !v)}
              className="w-8 h-8 rounded-lg text-white shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center"
              style={{ backgroundColor: 'var(--soft-head, #003057)' }}
              title={readOnly ? '엑셀 다운로드' : '새 주문 추가 · 엑셀 다운로드'}
              aria-label={readOnly ? '엑셀 다운로드' : '새 주문 추가·엑셀 다운로드'}
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
            >
              <Plus className="w-4 h-4" />
            </button>
            {actionMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setActionMenuOpen(false)} />
                <div role="menu" className="absolute right-0 top-10 z-50 w-56 rounded-xl bg-white shadow-lg border border-slate-200 p-1.5">
                  {!readOnly && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setActionMenuOpen(false);
                        setAddOrderModal(true);
                      }}
                      className="w-full h-11 px-3 flex items-center gap-2 rounded-lg text-sm font-bold text-left text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Plus className="w-4 h-4" />새 주문 추가
                    </button>
                  )}
                  <button
                    role="menuitem"
                    disabled={mainRows.length === 0}
                    onClick={() => {
                      setActionMenuOpen(false);
                      void exportOrders();
                    }}
                    className="w-full h-11 px-3 flex items-center gap-2 rounded-lg text-sm font-bold text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    title="정산용 엑셀 다운로드 — 별도 주문(택배) 고객"
                  >
                    <Download className="w-4 h-4" />정산용 엑셀 다운로드
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {effectiveMonitorMode === 'all' && summaryCard}

      <div className="relative flex flex-1 min-h-0 gap-2">
      <div
        className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative"
        // 모니터 1·2는 표 폭이 [고정 열 + 상품 열 수 × 최대 폭 + 테두리]를 넘지 않게 한다(열 폭 상한과 같은 기준).
        style={isSplitMode ? { maxWidth: productGridFixedWidth(nameColumn, terminalColumn) + productSlotCount * PRODUCT_COLUMN_MAX + 2 } : undefined}
      >
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
        {/* 주문이 하나도 없으면 빈 표(머리줄·빈 행)를 보여 주지 않고 문구만 보인다. 표는 숨기기만 하고 그대로 두어서(hidden),
            주문이 생겨 다시 보일 때 크기 관찰자(ResizeObserver)가 표 높이를 새로 재도록 한다. */}
        {rows.length === 0 && (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-slate-400">
            <Inbox className="w-8 h-8 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-medium">주문이 없습니다</p>
            <p className="text-xs text-slate-400">&apos;새 주문 추가&apos; 버튼을 누르거나, &apos;주문 입력&apos; 메뉴에서 카카오톡 메시지로 등록하세요</p>
          </div>
        )}
        <div ref={scrollRef} className={`flex-1 min-h-0 overflow-x-auto ${rows.length === 0 ? 'hidden' : ''} ${isSplitMode ? 'overflow-y-hidden' : 'overflow-y-auto'}`}>
          <div className={`flex flex-col ${isSplitMode ? 'h-full' : ''}`} style={isSplitMode ? undefined : { minWidth: productGridMinWidth(productSlotCount, nameColumn, terminalColumn) }}>
            {/* 헤더 */}
            <div
              ref={headerRef}
              className={`soft-head-line grid text-white text-xs font-bold flex-shrink-0 ${!isSplitMode ? 'sticky top-0 z-10' : ''}`}
              style={{ backgroundColor: 'var(--soft-head, #003057)', gridTemplateColumns: gridTemplate }}
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
                  상품 {i + 1}
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
                const rowItems = itemsOf(row.dailyBusinessId);

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
                          <span className="group-hover/row:invisible">{row.businessNumber}</span>
                          <GripVertical className="absolute w-4 h-4 text-slate-500 invisible group-hover/row:visible" />
                        </div>
                      ) : (
                        row.businessNumber
                      )}
                    </div>
                    {/* 터미널 칸은 칩만 보인다. 주문 수정·삭제는 고객명을 눌러 여는 패널에 있다(고객명 칸에는 아무것도 겹치지 않는다, 2026-11-14). */}
                    <div className="relative border-r border-slate-100 px-2 flex items-center justify-center">
                      <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md border text-[11px] font-bold ${terminalBadgeProps(row.terminal, terminalColors).className}`} style={terminalBadgeProps(row.terminal, terminalColors).style}>
                        {row.terminal || '-'}
                      </span>
                    </div>
                    <div
                      className={`relative border-r border-slate-100 px-2 flex items-center overflow-hidden ${isCardComplete(rowItems) ? 'bg-emerald-50' : isCardCancelled(rowItems) ? 'bg-rose-50' : ''} ${readOnly ? '' : 'cursor-pointer hover:bg-slate-100/70'}`}
                      {...(readOnly
                        ? {}
                        : {
                            role: 'button',
                            tabIndex: 0,
                            title: '누르면 이 고객의 상품 추가·수정·미출고·취소·삭제',
                            onClick: (e: React.MouseEvent<HTMLDivElement>) => openCustomerPanel(row.dailyBusinessId, e.currentTarget),
                            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault();
                              openCustomerPanel(row.dailyBusinessId, e.currentTarget);
                            },
                          })}
                    >
                      {/* 업체명은 현장에서 정확히 보여야 하므로 말줄임 없이 전체 폭을 쓴다(최대 2줄, 행 높이 고정). */}
                      <span className={`text-xs font-bold leading-[1.15] break-keep line-clamp-2 ${isCardCancelled(rowItems) ? 'text-rose-700 line-through decoration-rose-400' : 'text-slate-700'}`} title={row.memo ?? undefined}>{isCardComplete(rowItems) && <DoneBadge />}{isCardCancelled(rowItems) && <CancelledBadge />}{roundOf(row) && <RoundBadge round={roundOf(row) as OrderRound} />}{row.businessName}</span>
                      {row.memo && <span className="ml-1 w-1.5 h-1.5 shrink-0 rounded-full bg-amber-400" />}
                    </div>
                    {/* 박스 구성을 정한 뒤 주문이 바뀌면 이 칸이 붉게 바뀌고 경고 아이콘이 붙는다. 고객명 칸에는 아무것도 붙이지 않는다(이름은 절대 가려지면 안 된다, 2026-11-14). */}
                    <div
                      className={`border-r border-slate-100 px-1 flex items-center justify-center gap-1 whitespace-nowrap ${row.packingChanged && !isCardCancelled(rowItems) ? 'bg-rose-100' : 'bg-slate-50/60'} ${canOpenBox && !isCardCancelled(rowItems) ? 'cursor-pointer hover:bg-slate-200/70' : ''}`}
                      title={isCardCancelled(rowItems) ? '주문이 모두 취소된 업체 — 박스 할당이 필요 없습니다' : canOpenBox ? (row.packingChanged ? '주문이 바뀌었습니다 — 눌러서 박스 할당을 다시 확인하세요' : '누르면 이 업체의 박스 할당을 고칩니다') : row.packingChanged ? '주문이 바뀌었습니다 — 박스 할당에서 박스 구성을 다시 확인하세요' : undefined}
                      {...(canOpenBox && !isCardCancelled(rowItems)
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => setBoxModal({ dailyBusinessId: row.dailyBusinessId, title: row.businessName }),
                            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setBoxModal({ dailyBusinessId: row.dailyBusinessId, title: row.businessName })),
                          }
                        : {})}
                    >
                      <span className={`text-sm font-bold tabular-nums ${row.totalBoxes == null || isCardCancelled(rowItems) ? 'text-slate-300' : row.packingChanged ? 'text-rose-700' : 'text-slate-700'}`} title="박스 할당에서 정한 박스 수">{isCardCancelled(rowItems) ? '-' : (row.totalBoxes ?? '-')}</span>
                      {row.packingChanged && !isCardCancelled(rowItems) && <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-rose-600" strokeWidth={2.5} aria-label="박스 재확인 필요" />}
                      {row.mergeGroups.length > 0 && <span className="rounded border border-emerald-300 bg-emerald-50 px-1 text-[10px] font-bold text-emerald-800" title={`합포장: ${row.mergeGroups.map((g) => g.join('·') + '번').join(', ')}`} aria-label="합포장">합</span>}
                    </div>

                    {Array.from({ length: productSlotCount }).map((_, slotIndex) => {
                      const item = rowItems[slotIndex];

                      if (!item) {
                        // 업체 메모는 상품이 끝난 뒤 남는 빈 칸들을 하나로 합쳐서 보여준다(칸이 모자라면 이름 옆 점으로 대신).
                        if (row.memo) {
                          if (slotIndex !== rowItems.length) return null;
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
                        // 빈 칸은 완전히 비워 둔다. 테두리는 다른 칸과 똑같이 그려서 열 경계가 행마다 어긋나 보이지 않게 한다
                        // (이 업체는 그만큼 상품이 없다는 뜻이라 "없음" 표시를 칸마다 반복할 이유가 없다).
                        return <div key={slotIndex} className="border-r border-slate-100 last:border-r-0" />;
                      }

                      const { bg, border, text } = getItemStyle(item.changeStatus, item.isPacked, item.unshippedQuantity, item.quantity);
                      // 강조 상품은 이름만 색을 바꾼다. 취소·포장 완료 칸은 상태 표시(취소선, 회색)가 우선한다.
                      const highlightColor = item.changeStatus !== 'cancelled' && !item.isPacked ? hlColor.get(item.productName) : undefined;
                      const suffixParts: string[] = [];
                      if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
                      if (item.sizeRequest) suffixParts.push(item.sizeRequest);
                      if (prepLabelOf(item)) suffixParts.push(prepLabelOf(item) as string);
                      const suffix = suffixParts.length ? ` (${suffixParts.join(', ')})` : '';

                      return (
                        <div key={item.id} className="border-r border-slate-100 last:border-r-0 p-[1px] flex min-w-0">
                          <div data-chip={item.id} className={`relative w-full flex items-center justify-start px-1.5 rounded-lg border overflow-hidden ${bg} ${border} transition-all group shadow-sm`}>
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
                              onClick={() => !readOnly && handleTogglePacked(item)}
                              className="w-full min-w-0 flex flex-wrap items-baseline justify-start text-left gap-x-1 z-10 cursor-pointer select-none break-keep [overflow-wrap:anywhere]"
                              // 컨테이너의 글자 크기도 칩 글자 크기에 맞춘다: 안 맞추면 수량을 감싼 상자의 보이지 않는 줄 높이(strut)가 부모의 큰 기본 글자
                              // 크기로 잡혀서, 작은 글자 단계에서 글자가 칩 아래쪽으로 치우친다.
                              style={{ fontSize: 'var(--pq)', lineHeight: 'var(--pl, 1.15)', maxHeight: pillInnerHeight, transform: 'translateY(var(--pshift, 0px))' }}
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
                              {suffix && <span data-pill-opt className="font-semibold text-sky-600" style={{ fontSize: 'var(--po)' }}>{suffix.trim()}</span>}
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
            </div>
            </SortableContext>
            </DndContext>
          </div>
        </div>
      </div>
        {effectiveMonitorMode === '2' && productPanel}
        {/* 칠판 펜: 터치 기기(스마트 칠판)이고 수정 권한이 있고 오늘(또는 과거 편집 허용)인 모니터 1·2에서만 그릴 수 있다. 전체보기는 스크롤로 그림이 어긋나서 제외한다.
            그릴 수 없는 기기(PC 등)는 같은 그림을 읽기 전용으로 겹쳐 본다(서버에 저장된 그림, 툴바 버튼으로 숨길 수 있다). */}
        {separateOpen ? null : inkWriter ? (
          <InkLayer key={`${orderDate}|${effectiveMonitorMode}`} date={orderDate} monitor={effectiveMonitorMode} dry={inkDry} items={inkItems} onPack={(id) => handleSetPacked(id, true)} onUnpack={(id) => handleSetPacked(id, false)} onActiveChange={setPenActive} />
        ) : (
          hydrated && isSplitMode && !inkHidden && <InkLayer key={`view|${orderDate}|${effectiveMonitorMode}`} viewOnly date={orderDate} monitor={effectiveMonitorMode} dry={false} items={inkItems} onPack={noopId} onUnpack={noopId} onActiveChange={noopActive} />
        )}
      </div>

      {separateOpen && (
        <div className="fixed inset-0 z-[60] overflow-hidden overscroll-contain bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setSeparateOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl flex-shrink-0" style={{ backgroundColor: 'var(--soft-head, #003057)' }}>
              <h3 className="text-sm font-bold text-white tracking-wide">별도 주문 ({separateRows.length}) — {[...separateNames].join(', ')}</h3>
              {sepPages.length > 1 && (
                <div role="tablist" aria-label="별도 주문 모니터" className="ml-auto mr-4 flex gap-1">
                  {sepPages.map((_, i) => (
                    <button key={i} role="tab" aria-selected={i === sepPageNo} onClick={() => setSepPage(i)} className={`rounded-md px-3 py-1 text-xs font-bold ${i === sepPageNo ? 'bg-white text-[#003057]' : 'bg-white/15 text-white hover:bg-white/30'}`}>
                      모니터 {i + 1}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setSeparateOpen(false)} className="text-white/70 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="relative flex-1 min-h-0 flex gap-3 p-4">
            <div ref={sepListRef} className="relative flex-1 min-w-0 overflow-auto overscroll-contain flex flex-col rounded-lg border border-slate-200">
              {separateRows.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-10">별도 주문이 없습니다. 터미널 관리에서 &apos;별도 주문&apos;으로 지정한 터미널의 주문이 여기에 모입니다.</p>
              )}
              {/* 주문 목록과 같은 표 모양: 헤더 + 칸마다 테두리가 있는 행. 상품 열 수는 이 팝업의 모든 행 중 상품이 가장 많은 업체 기준이다(쪽을 넘겨도 열이 안 바뀐다). */}
              {separateRows.length > 0 && (
                <div className="soft-head-line grid flex-shrink-0 sticky top-0 z-10 text-white text-xs font-bold" style={{ backgroundColor: 'var(--soft-head, #003057)', gridTemplateColumns: sepGridTemplate, minWidth: sepMinWidth, height: SEP_HEADER_H }}>
                  <div className="border-r border-b-2 border-white/20 px-2 flex items-center justify-center">No</div>
                  <div className="border-r border-b-2 border-white/20 px-2 flex items-center justify-center">터미널</div>
                  <div className="border-r border-b-2 border-white/20 px-3 flex items-center">고객명</div>
                  <div className="border-r border-b-2 border-white/20 px-2 flex items-center justify-center">박스</div>
                  {Array.from({ length: sepSlotCount }).map((_, i) => (
                    <div key={i} className="border-r last:border-r-0 border-b-2 border-white/20 px-1.5 flex items-center justify-center text-center">상품 {i + 1}</div>
                  ))}
                </div>
              )}
              <DndContext id="separate-dnd" sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleSeparateDragEnd}>
              <SortableContext items={separateRows.filter((r) => sepVisible.has(r.dailyBusinessId)).map((r) => r.dailyBusinessId)} strategy={verticalListSortingStrategy}>
              {separateRows.map((row) => {
                const rowItems = itemsOf(row.dailyBusinessId);
                const visible = sepVisible.has(row.dailyBusinessId);
                const cancelledCard = isCardCancelled(rowItems);
                const density = SEP_DENSITIES[sepDensity];
                return (
                  <div key={row.dailyBusinessId} data-sep-row={row.dailyBusinessId} data-ink-ignore={visible ? undefined : ''} aria-hidden={!visible} className={visible ? '' : 'invisible absolute inset-x-0 top-0 pointer-events-none'} style={{ minWidth: sepMinWidth }}>
                  <SortableRow
                    id={row.dailyBusinessId}
                    disabled={readOnly} // 숨긴 행도 손잡이 칸까지 같은 모양이어야 높이를 똑같이 잰다(숨긴 행은 pointer-events가 꺼져 있어 끌 수 없다)
                    className="group/row grid border-b border-slate-100 bg-white hover:bg-slate-50/50 transition-colors"
                    style={{ gridTemplateColumns: sepGridTemplate }}
                  >
                    {(handle) => (
                    <>
                    <div className="border-r border-slate-100 px-2 flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-50">
                      {handle ? (
                        <div
                          ref={handle.ref}
                          {...handle.props}
                          className={`relative w-full h-full ${density.no} flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none`}
                          title="끌어서 순서 변경"
                        >
                          <span className="group-hover/row:invisible">{row.businessNumber}</span>
                          <GripVertical className="absolute w-4 h-4 text-slate-500 invisible group-hover/row:visible" />
                        </div>
                      ) : (
                        row.businessNumber
                      )}
                    </div>
                    <div className="border-r border-slate-100 px-2 flex items-center justify-center">
                      <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md border text-[11px] font-bold ${terminalBadgeProps(row.terminal, terminalColors).className}`} style={terminalBadgeProps(row.terminal, terminalColors).style}>{row.terminal || '-'}</span>
                    </div>
                    <div className={`border-r border-slate-100 px-3 ${density.name} flex flex-col justify-center gap-0.5 min-w-0 ${isCardComplete(rowItems) ? 'bg-emerald-50' : cancelledCard ? 'bg-rose-50' : ''}`}>
                      <span className={`text-sm font-bold break-keep leading-tight ${cancelledCard ? 'text-rose-700' : 'text-slate-800'}`}>{isCardComplete(rowItems) && <DoneBadge />}{cancelledCard && <CancelledBadge />}{roundOf(row) && <RoundBadge round={roundOf(row) as OrderRound} />}<EditableCardName row={row} readOnly={readOnly} onOpen={(el) => openCustomerPanel(row.dailyBusinessId, el)} /></span>
                      {row.memo && <span className="text-[11px] font-bold leading-tight text-amber-700">메모: {row.memo}</span>}
                    </div>
                    <div className="border-r border-slate-100 px-1 flex items-center justify-center gap-1 whitespace-nowrap bg-slate-50/60">
                      <span className={`text-sm font-bold tabular-nums ${row.totalBoxes == null || cancelledCard ? 'text-slate-300' : 'text-slate-700'}`} title="박스 할당에서 정한 박스 수">{cancelledCard ? '-' : (row.totalBoxes ?? '-')}</span>
                      {row.mergeGroups.length > 0 && <span className="rounded border border-emerald-300 bg-emerald-50 px-1 text-[10px] font-bold text-emerald-800" title={`합포장: ${row.mergeGroups.map((g) => g.join('·') + '번').join(', ')}`} aria-label="합포장">합</span>}
                    </div>
                    {Array.from({ length: sepSlotCount }).map((_, slotIndex) => {
                      const item = rowItems[slotIndex];
                      // 빈 칸도 다른 칸과 같은 테두리로 그려서 열 경계가 행마다 어긋나 보이지 않게 한다.
                      if (!item) return <div key={slotIndex} className="border-r border-slate-100 last:border-r-0" />;
                      const { bg, border, text } = getItemStyle(item.changeStatus, item.isPacked, item.unshippedQuantity, item.quantity);
                      const suffixParts: string[] = [];
                      if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
                      if (item.sizeRequest) suffixParts.push(item.sizeRequest);
                      if (prepLabelOf(item)) suffixParts.push(prepLabelOf(item) as string);
                      return (
                        <div key={item.id} className={`border-r border-slate-100 last:border-r-0 ${density.cell} flex min-w-0`}>
                          <div data-chip={item.id} className={`relative w-full ${density.chip} flex flex-wrap items-center justify-start content-center gap-x-1 px-1.5 rounded-lg border text-xs text-left break-keep [overflow-wrap:anywhere] shadow-sm ${bg} ${border} ${text} ${readOnly ? '' : 'cursor-pointer'}`} onClick={() => !readOnly && handleTogglePacked(item)}>
                            <span className="font-bold">{item.productName}</span>
                            {isUndecidedQuantity(item) ? (
                              <span className="rounded bg-amber-100 px-1 font-black text-amber-700 whitespace-nowrap">수량 미정</span>
                            ) : (
                              <span className="whitespace-nowrap"><span className="font-black text-sm">{item.quantity}</span><span className="ml-0.5 font-semibold">{item.unit}</span></span>
                            )}
                            {suffixParts.length > 0 && <span className="font-semibold text-sky-600">({suffixParts.join(', ')})</span>}
                            {item.unshippedQuantity > 0 && item.changeStatus !== 'cancelled' && (
                              <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1 py-[1px]" title={item.unshippedReason ?? undefined}>미출고 {item.unshippedQuantity}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </>
                    )}
                  </SortableRow>
                  </div>
                );
              })}
              </SortableContext>
              </DndContext>
            </div>
            {separateColumns.length > 0 && <ProductSummaryPanel columns={separateColumns} chipStyle={chipStyle} availHeight={sepAvail > 0 ? sepAvail : undefined} onPick={(p, r) => pickProduct('separate', p, r)} />}
            {/* 별도 주문 팝업의 펜: 주문 목록과 같다(그릴 수 있는 기기는 쓰고, 아니면 같은 그림을 읽기 전용으로 본다). 그림은 모니터 1·2와 따로 쪽마다(s1·s2…) 저장한다. */}
            {inkWriterPopup ? (
              <InkLayer key={`sep|${orderDate}|${sepPageNo}`} date={orderDate} monitor={`s${sepPageNo + 1}`} dry={inkDry} items={inkItems} onPack={(id) => handleSetPacked(id, true)} onUnpack={(id) => handleSetPacked(id, false)} onActiveChange={setPenActive} />
            ) : (
              hydrated && !inkHidden && <InkLayer key={`sepview|${orderDate}|${sepPageNo}`} viewOnly date={orderDate} monitor={`s${sepPageNo + 1}`} dry={false} items={inkItems} onPack={noopId} onUnpack={noopId} onActiveChange={noopActive} />
            )}
            </div>
          </div>
        </div>
      )}

      {overlays}
    </div>
  );
}
