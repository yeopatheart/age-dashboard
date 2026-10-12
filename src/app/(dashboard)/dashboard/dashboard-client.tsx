'use client';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Plus, Pencil, Trash2, X, Inbox, ChevronDown, ChevronLeft, ChevronRight, Download, LayoutGrid, Monitor, Truck } from 'lucide-react';
import { getProductSummary, getTerminalBoxTotals, type OrderItem, type OrderRow, type ChangeStatus } from '@/lib/orders';
import { terminalBadgeProps, terminalDotProps, type TerminalColorMap } from '@/lib/terminal-color';
import { resolveColors } from '@/lib/color-palette';
import {
  togglePacked,
  updateTotalBoxes,
  createManualOrder,
  updateOrder,
  deleteDailyBusiness,
  addOrderItemManual,
  updateOrderItemManual,
  cancelOrderItem,
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
function productGridTemplate(slotCount: number) {
  return `40px 80px 144px 56px repeat(${slotCount}, minmax(130px, 1fr))`;
}

function getItemStyle(status: ChangeStatus, isPacked: boolean) {
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

const SUGGESTION_ROW_HEIGHT = 36;
const SUGGESTION_VISIBLE_ROWS = 5;

function OrderFormModal({
  initial,
  terminals,
  businesses,
  registeredBusinessIds = [],
  onSave,
  onClose,
}: {
  initial?: { businessName: string; terminalId: string | null; totalBoxes: number };
  terminals: Terminal[];
  businesses: BusinessDirectoryEntry[];
  // 이 날짜 대시보드에 이미 올라와 있는 업체 id — 새 주문 추가에서 중복 등록을 막는다.
  registeredBusinessIds?: string[];
  onSave: (data: { businessName: string; terminalId: string | null; totalBoxes: number }) => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(initial);
  const modalColors: TerminalColorMap = Object.fromEntries(terminals.map((t) => [t.name, { fill: t.fill_color, border: t.border_color }]));
  const [businessName, setBusinessName] = useState(initial?.businessName ?? '');
  const [terminalId, setTerminalId] = useState(initial?.terminalId ?? terminals[0]?.id ?? '');
  const [totalBoxes, setTotalBoxes] = useState(initial?.totalBoxes?.toString() ?? '1');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState(false);

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

  const handleSave = () => {
    if (!businessName.trim() || (!isEdit && !matchedBusiness)) return;
    if (matchedBusiness && registeredBusinessIds.includes(matchedBusiness.id)) {
      setDuplicateError(true);
      return;
    }
    const resolvedTerminalId = isEdit ? (terminalId || null) : (matchedTerminal?.id ?? null);
    onSave({ businessName: (matchedBusiness?.name ?? businessName).trim(), terminalId: resolvedTerminalId, totalBoxes: parseInt(totalBoxes) || 1 });
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
        {duplicateError && matchedBusiness && (
          <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            &apos;{matchedBusiness.name}&apos;은(는) 이미 대시보드에 등록된 고객입니다. 상품은 해당 행의 + 버튼으로 추가해주세요.
          </p>
        )}
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">박스 수량</label>
          <input
            type="number" min="1"
            value={totalBoxes}
            onChange={(e) => setTotalBoxes(e.target.value)}
            className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#003057] focus:outline-none"
          />
        </div>
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
}: {
  rows: OrderRow[];
  items: OrderItem[];
  allTerminals: Terminal[];
  businessDirectory: BusinessDirectoryEntry[];
  orderDate: string;
  today: string;
  productColors: Record<string, { fill: string | null; border: string | null }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monitorMode = searchParams.get('monitor') || '1';

  // 과거 날짜는 최종 상태를 보는 조회 전용 — 실수로 지난 기록을 고치지 않게 편집 수단을 숨긴다.
  const readOnly = orderDate !== today;

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
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'order' | 'item'; dailyBusinessId?: string; itemId?: string } | null>(null);

  const terminalColors: TerminalColorMap = Object.fromEntries(allTerminals.map((t) => [t.name, { fill: t.fill_color, border: t.border_color }]));
  // 택배·직배송처럼 "별도 주문"으로 표시한 터미널은 기본 주문표에서 빼고, 별도 주문 보기에서만 모아 본다.
  const separateNames = new Set(allTerminals.filter((t) => t.is_separate).map((t) => t.name));
  // 주문표 순서는 주문 입력된 순서 그대로다(업체 번호 = 입력 순서, 서버에서 업체 번호순으로 내려준다).
  // 터미널·상품 수 등으로 다시 정렬하지 않는다.
  const allRows = rawRows;
  const separateRows = allRows.filter((r) => separateNames.has(r.terminal));
  const mainRows = allRows.filter((r) => !separateNames.has(r.terminal));
  const rows = mainRows;
  const [separateOpen, setSeparateOpen] = useState(false);
  const columns = getProductSummary(items);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const headerEl = headerRef.current;
    if (!scrollEl || !headerEl) return;
    const measure = () => setAvailHeight(Math.max(0, scrollEl.clientHeight - headerEl.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    ro.observe(headerEl);
    return () => ro.disconnect();
  }, []);

  const rowHeight =
    availHeight > 0
      ? ROW_HEIGHT_TIERS.find((h) => MONITOR_COUNT * Math.floor(availHeight / h) >= rows.length) ?? MIN_ROW_HEIGHT
      : ROW_HEIGHT_TIERS[0];
  const ownCapacity = availHeight > 0 ? Math.max(1, Math.floor(availHeight / rowHeight)) : INITIAL_ROW_CAPACITY;
  const startIndex = effectiveMonitorMode === '2' ? ownCapacity : 0;
  // 화면에 다 못 들어가는 줄은 이 화면에 표시하지 않고 다음 모니터로 넘긴다.
  const monitorSlice = isSplitMode ? rows.slice(startIndex, startIndex + ownCapacity) : rows;
  const displayedRows = monitorSlice;
  const rowSlotCount = isSplitMode ? ownCapacity : displayedRows.length;
  // gridTemplateRows를 고정하지 않으면 내용이 긴 칸 하나가 행 전체를 키워서 행 높이 규칙이 깨진다.
  const rowStyle = { height: rowHeight, gridTemplateRows: `${rowHeight}px` };
  // 상품 팁은 한 줄에 다 들어가면 한 줄, 아니면 같은 행 높이 안에서 2줄로 나눠 보여준다(상품명을 말줄임하지
  // 않는다). 2줄이 팁 안에 들어가도록 글자 크기·줄 높이를 행 높이 단계에 맞춰 정한다 — 행이 높은 단계(40/36px)
  // 에서는 기본 크기(상품명 11px / 수량 14px) 그대로이고, 가장 촘촘한 30px 단계에서만 10px / 12px까지 줄어든다.
  // 팁 안쪽 높이 = 행 높이 − 테두리 1 − 칸 여백 4 − 팁 테두리 2.
  const pillLineHeight = Math.floor((rowHeight - 7) / 2);
  const pillNameFont = Math.min(11, pillLineHeight - 1);
  const pillQtyFont = Math.min(14, pillLineHeight + 1);

  // 열 개수는 "이 화면에 실제로 보이는 행" 중 상품이 가장 많은 업체 기준 + 1(추가 버튼 열)이다.
  // 모니터마다 다른 업체가 보이므로 전체 기준이 아니라 화면에 표시되는 행 기준으로 센다.
  const maxProductCount = displayedRows.reduce((max, row) => {
    const count = items.filter((i) => i.dailyBusinessId === row.dailyBusinessId).length;
    return Math.max(max, count);
  }, 0);
  const productSlotCount = maxProductCount + 1;

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
      row.businessName,
      row.totalBoxes,
      row.memo ?? '',
      ...Array.from({ length: maxItems }, (_, i) => {
        const item = rowItems[idx][i];
        if (!item) return '';
        const extra = [item.secondaryWeightKg != null ? `${item.secondaryWeightKg}kg` : null, item.sizeRequest].filter(Boolean).join(', ');
        return `${STATUS_PREFIX[item.changeStatus] ?? ''}${item.productName} ${item.quantity}${item.unit}${extra ? ` (${extra})` : ''}`;
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

  const handleTogglePacked = async (item: OrderItem) => {
    if (item.changeStatus === 'cancelled') return;
    await togglePacked(item.id, !item.isPacked);
    refresh();
  };

  const handleSaveOrder = async (data: { businessName: string; terminalId: string | null; totalBoxes: number }) => {
    if (editOrderModal) {
      await updateOrder(editOrderModal.dailyBusinessId, data.businessName, data.terminalId);
      await updateTotalBoxes(editOrderModal.dailyBusinessId, data.totalBoxes);
      setEditOrderModal(null);
    } else {
      await createManualOrder(orderDate, data.businessName, data.terminalId, data.totalBoxes);
      setAddOrderModal(false);
    }
    refresh();
  };

  const handleBoxesInput = async (row: OrderRow, value: string) => {
    const n = parseInt(value) || 0;
    await updateTotalBoxes(row.dailyBusinessId, n);
    refresh();
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
  const productChips = columns.map((product) => (
    <div
      key={product.productName}
      className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5"
      style={chipStyle(product.productName)}
    >
      <span className="text-xs font-bold">{product.productName}</span>
      <span className="text-xs font-black">{product.total}{product.unit}</span>
    </div>
  ));
  const summaryCard = (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex-shrink-0 overflow-hidden" style={{ borderTop: '3px solid #003057' }}>
      <div className="flex items-center gap-2 px-3 py-3 flex-wrap">
        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">품목별 수량</span>
        {productChips}
      </div>
    </div>
  );

  // 세로 패널은 2열인데, 칸 하나에 이름+수량이 안 들어가는 긴 이름(말줄임이 생길 품목)은 한 줄 전체를
  // 쓰게 하고 맨 뒤로 보낸다 — 이름이 잘리면 현장에서 어떤 품목인지 알 수 없다. 칸 폭은 w-64(256) − 패널
  // 여백(12) → 2열 사이 간격(4)을 뺀 열당 약 120px, 칩 안쪽 여백(12)을 뺀 약 108px이다.
  const [longNames, setLongNames] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      const family = getComputedStyle(document.body).fontFamily;
      const width = (text: string, weight: number) => {
        ctx.font = `${weight} 12px ${family}`;
        return ctx.measureText(text).width;
      };
      const available = 108 - 4; // 이름과 수량 사이 간격(gap-1)
      setLongNames(new Set(columns.filter((c) => width(c.productName, 700) + width(`${c.total}${c.unit}`, 900) > available).map((c) => c.productName)));
    };
    measure();
    // 웹폰트가 늦게 로드되면 폭이 달라지므로 로드 후 한 번 더 잰다.
    void document.fonts?.ready.then(measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const panelColumns = [...columns.filter((c) => !longNames.has(c.productName)), ...columns.filter((c) => longNames.has(c.productName))];
  const shortCount = columns.length - longNames.size;

  // 세로 패널: 품목이 늘어도 스크롤이 생기지 않게 2열 그리드의 줄 높이·글자 크기를 패널 높이에 맞춰 줄인다.
  const panelItemHeight = Math.min(
    26,
    Math.max(14, Math.floor((Math.max(availHeight, 300) - 8) / Math.max(1, Math.ceil(shortCount / 2) + longNames.size))),
  );
  const productPanel = (
    <aside className="w-64 flex-shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ borderTop: '3px solid #003057' }}>
      <div className="px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50 border-b border-slate-100 flex-shrink-0">품목별 수량</div>
      <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-2 content-start gap-x-1 p-1.5">
        {panelColumns.map((product) => (
          <div
            key={product.productName}
            className={`flex items-center justify-between gap-1 px-1.5 rounded border mb-px overflow-hidden ${longNames.has(product.productName) ? 'col-span-2' : ''}`}
            style={{ ...chipStyle(product.productName), height: panelItemHeight - 1, fontSize: Math.min(12, panelItemHeight - 6) }}
          >
            <span className="font-bold truncate leading-none">{product.productName}</span>
            <span className="font-black shrink-0 leading-none">{product.total}{product.unit}</span>
          </div>
        ))}
      </div>
    </aside>
  );

  return (
    // 대시보드 페이지의 여백 자체는 dashboard-shell.tsx의 .main-content-tight가 담당한다
    // (12px/16px) — 여기서 음수 마진으로 상쇄하는 방식은 main-content의 overflow-y:auto가
    // overflow-x까지 auto로 끌어올리는 CSS 규칙과 부딪혀 표 오른쪽이 잘려 보이는 버그가 있었다.
    <div className="flex flex-col h-[calc(100vh-24px)] gap-2">
      <div className="flex justify-between items-center bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm flex-shrink-0 flex-wrap gap-3">
        <div className="flex gap-4 items-center flex-wrap">
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
            {readOnly ? (
              <>
                <button onClick={() => setDate(today)} className="ml-1 px-2.5 py-1 rounded-md bg-[#003057] text-white text-xs font-bold">오늘</button>
              </>
            ) : (
              <span className="ml-1 px-2 py-1 rounded-md bg-slate-100 text-xs font-bold text-slate-500">오늘</span>
            )}
          </div>
          <div className="w-px h-4 bg-slate-200 mx-1.5" />
          {terminalBoxTotals.map(({ terminal, boxes }) => (
            <div key={terminal} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-bold ${terminalBadgeProps(terminal, terminalColors).className}`} style={terminalBadgeProps(terminal, terminalColors).style}>
              <span>{terminal || '(터미널 없음)'}</span>
              <span className="font-black">{boxes}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 ml-auto">
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
          <div className={`flex flex-col ${isSplitMode ? 'h-full' : ''}`}>
            {/* 헤더 */}
            <div
              ref={headerRef}
              className={`grid text-white text-xs font-bold flex-shrink-0 ${!isSplitMode ? 'sticky top-0 z-10' : ''}`}
              style={{ backgroundColor: '#003057', gridTemplateColumns: productGridTemplate(productSlotCount) }}
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
                  <div
                    key={row.dailyBusinessId}
                    className={`grid border-b border-slate-100 hover:bg-slate-50/50 transition-colors shrink-0`}
                    style={{ gridTemplateColumns: productGridTemplate(productSlotCount), ...rowStyle }}
                  >
                    <div className="border-r border-slate-100 px-2 flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-50">
                      {index + startIndex + 1}
                    </div>
                    <div className="border-r border-slate-100 px-2 flex items-center justify-center">
                      <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md border text-[11px] font-bold ${terminalBadgeProps(row.terminal, terminalColors).className}`} style={terminalBadgeProps(row.terminal, terminalColors).style}>
                        {row.terminal || '-'}
                      </span>
                    </div>
                    <div className="relative border-r border-slate-100 px-2 flex items-center group overflow-hidden">
                      {/* 업체명은 현장에서 정확히 보여야 하므로 말줄임 없이 전체 폭을 쓰고(최대 2줄, 행 높이 고정),
                          수정/삭제 버튼은 마우스를 올릴 때만 이름 위에 겹쳐 나타난다. */}
                      <span className="text-xs font-bold text-slate-700 leading-[1.15] break-keep line-clamp-2" title={row.memo ?? undefined}>{row.businessName}</span>
                      {row.memo && <span className="ml-1 w-1.5 h-1.5 shrink-0 rounded-full bg-amber-400" />}
                      <div className={`absolute inset-y-0 right-0 pl-4 pr-1 flex items-center gap-1 opacity-0 ${readOnly ? 'hidden' : ''} group-hover:opacity-100 transition-opacity bg-gradient-to-l from-white via-white to-transparent`}>
                      <button
                        onClick={() => setEditOrderModal(row)}
                        className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-600 flex items-center justify-center flex-shrink-0"
                        title="주문 수정"
                      >
                        <Pencil className="w-2.5 h-2.5 text-slate-500 hover:text-white" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete({ type: 'order', dailyBusinessId: row.dailyBusinessId })}
                        className="w-5 h-5 rounded bg-rose-100 hover:bg-rose-500 flex items-center justify-center flex-shrink-0"
                        title="주문 삭제"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-rose-500 hover:text-white" />
                      </button>
                      </div>
                    </div>
                    <div className="border-r border-slate-100 px-2 bg-slate-50/60 flex items-center justify-center">
                      <input
                        type="number"
                        defaultValue={row.totalBoxes}
                        onBlur={(e) => handleBoxesInput(row, e.target.value)}
                        disabled={readOnly}
                        className="w-12 text-[11px] font-bold text-center border border-slate-300 rounded-md px-1.5 py-0.5 focus:border-[#003057] focus:outline-none bg-white"
                      />
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

                      const { bg, border, text } = getItemStyle(item.changeStatus, item.isPacked);
                      const suffixParts: string[] = [];
                      if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
                      if (item.sizeRequest) suffixParts.push(item.sizeRequest);
                      const suffix = suffixParts.length ? ` (${suffixParts.join(', ')})` : '';

                      return (
                        <div key={item.id} className="border-r border-slate-100 last:border-r-0 p-[2px] flex min-w-0">
                          <div className={`relative w-full flex items-center justify-center px-1.5 rounded-lg border overflow-hidden ${bg} ${border} transition-all group shadow-sm`}>
                            {item.isPacked && item.changeStatus !== 'cancelled' && (
                              <Check className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-slate-400/30" strokeWidth={4} />
                            )}
                            <div
                              onClick={() => !readOnly && handleTogglePacked(item)}
                              className="w-full min-w-0 flex flex-wrap items-center justify-center gap-x-1 z-10 cursor-pointer select-none overflow-hidden break-keep [overflow-wrap:anywhere]"
                              style={{ lineHeight: `${pillLineHeight}px`, maxHeight: pillLineHeight * 2 }}
                            >
                              <span className={`font-bold ${text}`} style={{ fontSize: pillNameFont }}>{item.productName}</span>
                              <span className="whitespace-nowrap">
                                <span className={`font-black ${text}`} style={{ fontSize: pillQtyFont }}>{item.quantity}</span>
                                <span className={`ml-0.5 font-semibold ${text}`} style={{ fontSize: pillNameFont }}>{item.unit}</span>
                              </span>
                              {suffix && <span className="font-semibold text-sky-600" style={{ fontSize: pillNameFont }}>{suffix.trim()}</span>}
                            </div>
                            <div className={`absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 ${readOnly ? 'hidden' : ''} group-hover:opacity-100 transition-opacity z-20`}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditItemModal(item); }}
                                className="w-4 h-4 rounded bg-slate-600 text-white flex items-center justify-center hover:bg-slate-800 transition-colors"
                                title="수정"
                              ><Pencil className="w-2.5 h-2.5" /></button>
                              {item.changeStatus !== 'cancelled' && (
                                <button
                                  onClick={async (e) => { e.stopPropagation(); await cancelOrderItem(item.id); refresh(); }}
                                  className="w-4 h-4 rounded bg-amber-400 text-white flex items-center justify-center hover:bg-amber-500 transition-colors"
                                  title="취소처리"
                                ><X className="w-2.5 h-2.5" /></button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'item', itemId: item.id }); }}
                                className="w-4 h-4 rounded bg-rose-400 text-white flex items-center justify-center hover:bg-rose-600 transition-colors"
                                title="삭제"
                              ><Trash2 className="w-2.5 h-2.5" /></button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
          </div>
        </div>
      </div>
        {effectiveMonitorMode === '2' && productPanel}
      </div>

      {separateOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setSeparateOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl flex-shrink-0" style={{ backgroundColor: '#003057' }}>
              <h3 className="text-sm font-bold text-white tracking-wide">별도 주문 ({separateRows.length}) — {[...separateNames].join(', ')}</h3>
              <button onClick={() => setSeparateOpen(false)} className="text-white/70 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-2">
              {separateRows.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-10">별도 주문이 없습니다. 터미널 관리에서 &apos;별도 주문&apos;으로 지정한 터미널의 주문이 여기에 모입니다.</p>
              )}
              {separateRows.map((row) => {
                const rowItems = items.filter((i) => i.dailyBusinessId === row.dailyBusinessId).sort((a, b) => a.productSequence - b.productSequence);
                return (
                  <div key={row.dailyBusinessId} className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-1.5 group">
                    <div className="w-72 flex-shrink-0 flex items-center gap-2">
                      <span className={`whitespace-nowrap flex-shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-bold ${terminalBadgeProps(row.terminal, terminalColors).className}`} style={terminalBadgeProps(row.terminal, terminalColors).style}>{row.terminal}</span>
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 break-keep leading-tight">{row.businessName}</span>
                      <span className="flex-shrink-0 text-xs text-slate-500 whitespace-nowrap">박스 {row.totalBoxes}</span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                      {row.memo && <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">메모: {row.memo}</span>}
                      {rowItems.map((item) => {
                        const { bg, border, text } = getItemStyle(item.changeStatus, item.isPacked);
                        const suffixParts: string[] = [];
                        if (item.secondaryWeightKg != null) suffixParts.push(`${item.secondaryWeightKg}kg`);
                        if (item.sizeRequest) suffixParts.push(item.sizeRequest);
                        return (
                          <div key={item.id} className={`relative group/pill flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs ${bg} ${border} ${text} ${readOnly ? '' : 'cursor-pointer'}`} onClick={() => !readOnly && handleTogglePacked(item)}>
                            <span className="font-bold">{item.productName}</span>
                            <span className="font-black text-sm">{item.quantity}</span>
                            <span className="font-semibold">{item.unit}</span>
                            {suffixParts.length > 0 && <span className="font-semibold text-sky-600">({suffixParts.join(', ')})</span>}
                            {!readOnly && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditItemModal(item); }}
                                className="ml-1 w-4 h-4 rounded bg-slate-600 text-white items-center justify-center hidden group-hover/pill:flex"
                                title="수정"
                              ><Pencil className="w-2.5 h-2.5" /></button>
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
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {addOrderModal && (
        <OrderFormModal terminals={allTerminals} businesses={businessDirectory} registeredBusinessIds={rows.map((r) => r.businessId)} onSave={handleSaveOrder} onClose={() => setAddOrderModal(false)} />
      )}
      {editOrderModal && (
        <OrderFormModal
          initial={{
            businessName: editOrderModal.businessName,
            terminalId: allTerminals.find((t) => t.name === editOrderModal.terminal)?.id ?? null,
            totalBoxes: editOrderModal.totalBoxes,
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
