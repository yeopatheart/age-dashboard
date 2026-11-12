'use client';
import { useMemo, useRef, useState } from 'react';
import { saveSales, type SalesPatch } from './actions';
import { useCan } from '@/components/permissions-context';
import { DataTable, SearchInput, type Column } from '@/components/admin/admin-kit';
import { useIsMobile } from '@/lib/use-is-mobile';
import { formatWon, formatWonDraft, parseWon, wonInputError } from '@/lib/money';
import { amountFromUnitPrice, canAutoFillPrice, type IssuedReceiptKey } from '@/lib/settlement/receipt';
import type { SalesRow } from '@/lib/settlement/sales';
import { ReceiptIssuePanel } from './receipt-issue-panel';

const PAGE_SIZE = 100; // 월 조회는 수천 줄이 될 수 있어 100줄씩 나눠 보여 준다
const NO_SELLER = '__none'; // 일괄 적용에서 "미지정으로 되돌리기"
const EMPTY_HIDDEN = new Set<string>();

type Edit = Partial<Pick<SalesRow, 'sellerId' | 'price' | 'unitPrice' | 'paid' | 'memo' | 'product' | 'quantity' | 'unit' | 'edited'>>;
type Drafts = Record<string, { price?: string; unitPrice?: string; memo?: string; product?: string; quantity?: string; unit?: string }>;

export function SettlementClient({
  rows,
  sellers,
  multiDay,
  from,
  to,
  issued,
}: {
  rows: SalesRow[];
  sellers: { id: string; name: string }[];
  multiDay: boolean;
  from: string; // 조회 기간(영수증 발행 때 서버가 같은 기간의 판매내역을 다시 읽는다)
  to: string;
  issued: IssuedReceiptKey[]; // 이 기간에 이미 발행한 영수증(중복 발행 경고에 쓴다)
}) {
  const canEdit = useCan()('settlement:edit');
  const isMobile = useIsMobile();
  // 저장 결과를 기다리지 않고 화면에 바로 보이는 값(실패하면 되돌린다). 기간을 옮기면 화면 상태가 새로 시작된다.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [drafts, setDrafts] = useState<Drafts>({}); // 입력 중인 판매가·메모(칸을 벗어날 때 저장한다)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [bulkSeller, setBulkSeller] = useState('');
  const [bulkPaid, setBulkPaid] = useState('');
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false); // 휴대폰에서 일괄 변경(사업자·입금) 영역을 펼쳤는지
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const view = (r: SalesRow): SalesRow => ({ ...r, ...edits[r.itemId] });
  const numbered = useMemo(() => rows.map((r, i) => ({ ...r, no: i + 1 })), [rows]);
  // 고객명·품목 검색(100줄 안에서 고객을 찾는 데 쓴다). 합계·건수 요약은 검색과 무관하게 조회된 전체 기준이다.
  const filteredRows = useMemo(() => {
    const k = search.trim().toLowerCase();
    return k ? numbered.filter((r) => r.customer.toLowerCase().includes(k) || r.product.toLowerCase().includes(k)) : numbered;
  }, [numbered, search]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const sellerName = new Map(sellers.map((s) => [s.id, s.name]));

  const viewed = numbered.map(view);
  const priced = viewed.filter((r) => r.price !== null);
  const totalPrice = priced.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const paidCount = viewed.filter((r) => r.paid).length;

  // 하나 또는 여러 줄의 값을 바꾼다. 화면에 먼저 반영하고 서버에 저장하며, 실패하면 이전 값으로 되돌린다.
  const commit = async (ids: string[], patch: Omit<SalesPatch, 'itemIds'>): Promise<boolean> => {
    if (ids.length === 0) return false;
    setError(null);
    setNotice(null);
    const local: Edit = {};
    if (patch.sellerId !== undefined) local.sellerId = patch.sellerId;
    if (patch.price !== undefined) local.price = patch.price;
    if (patch.unitPrice !== undefined) local.unitPrice = patch.unitPrice;
    if (patch.paid !== undefined) local.paid = patch.paid;
    if (patch.memo !== undefined) local.memo = patch.memo ?? '';
    // 품목·수량·단위를 고치거나 되돌린 값을 화면에 먼저 보인다(null = 주문 목록 원본으로 되돌림). 줄마다 원본이 달라 줄별로 계산한다.
    const itemEdits: Record<string, Edit> | null =
      patch.product !== undefined || patch.quantity !== undefined || patch.unit !== undefined
        ? Object.fromEntries(
            ids.map((id) => {
              const base = numbered.find((r) => r.itemId === id);
              const cur = { ...base, ...edits[id] } as SalesRow;
              const o = base?.original ?? { product: '', quantity: 0, unit: '' };
              const e: Edit = {};
              if (patch.product !== undefined) e.product = patch.product ?? o.product;
              if (patch.quantity !== undefined) e.quantity = patch.quantity ?? o.quantity;
              if (patch.unit !== undefined) e.unit = patch.unit ?? o.unit;
              const next = { product: e.product ?? cur.product, quantity: e.quantity ?? cur.quantity, unit: e.unit ?? cur.unit };
              e.edited = next.product !== o.product || next.quantity !== o.quantity || next.unit !== o.unit;
              return [id, e];
            }),
          )
        : null;
    const previous = Object.fromEntries(ids.map((id) => [id, edits[id]]));
    setEdits((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { ...prev[id], ...local, ...itemEdits?.[id] }])) }));
    setSaving((n) => n + 1);
    // 권한이 없거나 연결이 끊기면 서버 액션이 오류를 던진다. 그때도 저장 중 표시와 화면 값을 되돌린다.
    const result = await saveSales({ itemIds: ids, ...patch }).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
    if (!result.error) {
      // 저장이 끝났음을 잠깐 보여 준다(자동 저장이라 버튼이 없어서 저장됐는지 알 수 없다).
      setJustSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
    }
    if (result.error) {
      setEdits((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          if (previous[id]) next[id] = previous[id];
          else delete next[id];
        }
        return next;
      });
      setError(result.error);
      return false;
    }
    return true;
  };

  const setDraft = (id: string, key: 'price' | 'unitPrice' | 'memo' | 'product' | 'quantity' | 'unit', value: string) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  const clearDraft = (id: string, key: 'price' | 'unitPrice' | 'memo' | 'product' | 'quantity' | 'unit') =>
    setDrafts((prev) => {
      const { [key]: _removed, ...rest } = prev[id] ?? {};
      void _removed;
      return { ...prev, [id]: rest };
    });

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllOnPage = () => {
    const all = pageRows.length > 0 && pageRows.every((r) => selected.has(r.itemId));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (all) next.delete(r.itemId);
        else next.add(r.itemId);
      }
      return next;
    });
  };

  // 안내 문구는 몇 초 뒤 저절로 사라진다(오류는 다음 동작 때까지 남긴다).
  const flash = (message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };
  // 고객 이름을 누르면 그 고객의 같은 출고일 줄을 전체 선택·해제한다(영수증은 고객 × 사업자 × 출고일 단위로 만들어진다).
  const toggleCustomer = (row: SalesRow) => {
    const ids = numbered.filter((r) => r.customer === row.customer && r.orderDate === row.orderDate).map((r) => r.itemId);
    const all = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const applySeller = async () => {
    if (bulkSeller === '') return;
    const ids = [...selected];
    if (await commit(ids, { sellerId: bulkSeller === NO_SELLER ? null : bulkSeller })) {
      // 바꾼 뒤에도 선택을 유지한다 — 이어서 같은 줄로 영수증을 만들 수 있다.
      flash(`${ids.length}건의 사업자 구분을 ${bulkSeller === NO_SELLER ? '미지정으로' : `'${sellerName.get(bulkSeller)}'(으)로`} 바꿨습니다.`);
    }
  };
  const applyPaid = async () => {
    if (bulkPaid === '') return;
    const ids = [...selected];
    if (await commit(ids, { paid: bulkPaid === 'Y' })) {
      flash(`${ids.length}건의 입금 여부를 ${bulkPaid}로 바꿨습니다.`);
    }
  };

  const columns: Column<SalesRow & { no: number }>[] = [
    { key: 'no', label: '번호', hideable: false, className: 'ak-fit', render: (r) => r.no },
    ...(multiDay ? [{ key: 'date', label: '출고일', hideable: false, className: 'ak-fit', render: (r: SalesRow) => r.orderDate.slice(5).replace('-', '.') } satisfies Column<SalesRow & { no: number }>] : []),
    {
      key: 'seller',
      label: '사업자 구분',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        return (
          <select
            className="ak-select ak-select-seller"
            value={r.sellerId ?? ''}
            disabled={!canEdit}
            aria-label={`${r.customer} ${r.product} 사업자 구분`}
            onChange={(e) => void commit([r.itemId], { sellerId: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">미지정</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      },
    },
    {
      key: 'customer',
      label: '고객명',
      hideable: false,
      className: 'ak-sticky-col', // 휴대폰에서 옆으로 밀어도 고객명이 왼쪽에 붙어 있다
      render: (r) =>
        canEdit ? (
          <button type="button" className="ak-link-btn" onClick={() => toggleCustomer(r)} title="이 고객의 이 출고일 줄을 모두 선택·해제">
            <strong>{r.customer}</strong>
          </button>
        ) : (
          <strong>{r.customer}</strong>
        ),
    },
    {
      key: 'product',
      label: '품목',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        if (!canEdit) return r.product;
        return (
          <input
            className={`ak-input ${r.edited && r.product !== r.original.product ? 'ak-edited' : ''}`}
            style={{ width: '9rem', height: 'var(--ctl-h)' }}
            enterKeyHint="next"
            maxLength={60}
            aria-label={`${r.customer} 품목`}
            title={r.product !== r.original.product ? `주문 목록 품목: ${r.original.product}` : undefined}
            value={drafts[r.itemId]?.product ?? r.product}
            onChange={(e) => setDraft(r.itemId, 'product', e.target.value)}
            onBlur={() => {
              const draft = drafts[r.itemId]?.product;
              if (draft === undefined) return;
              clearDraft(r.itemId, 'product');
              const next = draft.trim();
              if (next === r.product) return;
              if (next === '') return flash('품목명을 비울 수 없습니다. 원래 값으로 되돌리려면 ↺ 버튼을 누르세요.');
              void commit([r.itemId], { product: next === r.original.product ? null : next }).then((ok) => ok && r.original.product !== next && flash('매입내역은 고친 품목명으로 따로 잡힙니다. 이전 품목명으로 입력한 매입가가 있으면 그 행이 그대로 남습니다.'));
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    {
      key: 'qty',
      label: '수량',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const r = view(r0);
        if (!canEdit) return `${formatWon(r.quantity)}${r.unit}`;
        const qtyChanged = r.quantity !== r.original.quantity;
        const unitChanged = r.unit !== r.original.unit;
        return (
          <span className="ak-qty">
            <input
              className={`ak-input ${qtyChanged ? 'ak-edited' : ''}`}
              style={{ width: '4.2rem', height: 'var(--ctl-h)', textAlign: 'right' }}
              inputMode="decimal"
              enterKeyHint="next"
              aria-label={`${r.customer} ${r.product} 수량`}
              title={qtyChanged ? `주문 목록 수량: ${formatWon(r.original.quantity)}${r.original.unit}` : undefined}
              value={drafts[r.itemId]?.quantity ?? String(r.quantity)}
              onChange={(e) => setDraft(r.itemId, 'quantity', e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => {
                const draft = drafts[r.itemId]?.quantity;
                if (draft === undefined) return;
                clearDraft(r.itemId, 'quantity');
                const next = Number(draft);
                if (draft === '' || !Number.isFinite(next) || next <= 0) return flash('수량은 0보다 큰 숫자로 입력해주세요.');
                if (next === r.quantity) return;
                void commit([r.itemId], { quantity: next === r.original.quantity ? null : next });
              }}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
            />
            <input
              className={`ak-input ${unitChanged ? 'ak-edited' : ''}`}
              style={{ width: '3.2rem', height: 'var(--ctl-h)' }}
              enterKeyHint="next"
              maxLength={10}
              aria-label={`${r.customer} ${r.product} 단위`}
              title={unitChanged ? `주문 목록 단위: ${r.original.unit}` : undefined}
              value={drafts[r.itemId]?.unit ?? r.unit}
              onChange={(e) => setDraft(r.itemId, 'unit', e.target.value)}
              onBlur={() => {
                const draft = drafts[r.itemId]?.unit;
                if (draft === undefined) return;
                clearDraft(r.itemId, 'unit');
                const next = draft.trim();
                if (next === '') return flash('단위를 비울 수 없습니다.');
                if (next === r.unit) return;
                void commit([r.itemId], { unit: next === r.original.unit ? null : next });
              }}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
            />
            {r.edited && (
              <button
                type="button"
                className="ak-undo-btn"
                title={`원래대로: ${r.original.product} ${formatWon(r.original.quantity)}${r.original.unit}`}
                aria-label={`${r.customer} ${r.product} 품목·수량을 주문 목록 값으로 되돌리기`}
                onClick={() => void commit([r.itemId], { product: null, quantity: null, unit: null })}
              >
                ↺
              </button>
            )}
          </span>
        );
      },
    },
    {
      key: 'unitPrice',
      label: '단가(원)',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        const invalid = wonInputError(drafts[r.itemId]?.unitPrice ?? '') !== null;
        return (
          <input
            className="ak-input"
            style={{ width: '7.5rem', height: 'var(--ctl-h)', textAlign: 'right', ...(invalid ? { borderColor: 'var(--danger)' } : {}) }}
            aria-invalid={invalid}
            inputMode="numeric"
            enterKeyHint="next"
            placeholder="단가→판매가 자동"
            disabled={!canEdit}
            aria-label={`${r.customer} ${r.product} 단가`}
            value={drafts[r.itemId]?.unitPrice ?? formatWon(r.unitPrice)}
            onChange={(e) => setDraft(r.itemId, 'unitPrice', formatWonDraft(e.target.value))}
            onBlur={() => {
              const draft = drafts[r.itemId]?.unitPrice;
              if (draft === undefined) return;
              clearDraft(r.itemId, 'unitPrice');
              const problem = wonInputError(draft);
              if (problem) return flash(`단가를 저장하지 않았습니다. ${problem}`);
              const next = parseWon(draft);
              if (next === r.unitPrice) return;
              // 단가를 입력하면 판매가를 단가 × 수량(원 단위 반올림)으로 채운다. 단, 판매가가 비어 있거나 이전 단가로 자동 계산된 값일 때만이다 —
              // 사용자가 따로 적은 판매가(할인가 등)는 덮어쓰지 않는다. 단가를 지우면 판매가는 그대로 둔다.
              if (next === null) {
                void commit([r.itemId], { unitPrice: null });
              } else if (canAutoFillPrice(r.price, r.unitPrice, r.quantity)) {
                void commit([r.itemId], { unitPrice: next, price: amountFromUnitPrice(next, r.quantity) });
              } else {
                void commit([r.itemId], { unitPrice: next }).then((ok) => ok && flash('이미 입력한 판매가는 그대로 두었습니다. 금액을 바꾸려면 판매가를 직접 고쳐주세요.'));
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    {
      key: 'price',
      label: '판매가(원)',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        const invalid = wonInputError(drafts[r.itemId]?.price ?? '') !== null;
        return (
          <input
            className="ak-input"
            style={{ width: '9.5rem', height: 'var(--ctl-h)', textAlign: 'right', ...(invalid ? { borderColor: 'var(--danger)' } : {}) }}
            aria-invalid={invalid}
            inputMode="numeric"
            enterKeyHint="next"
            placeholder="0"
            disabled={!canEdit}
            aria-label={`${r.customer} ${r.product} 판매가`}
            value={drafts[r.itemId]?.price ?? formatWon(r.price)}
            onChange={(e) => setDraft(r.itemId, 'price', formatWonDraft(e.target.value))}
            onBlur={() => {
              const draft = drafts[r.itemId]?.price;
              if (draft === undefined) return;
              clearDraft(r.itemId, 'price');
              const problem = wonInputError(draft);
              if (problem) return flash(`판매가를 저장하지 않았습니다. ${problem}`);
              const next = parseWon(draft);
              if (next !== r.price) void commit([r.itemId], { price: next });
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    {
      key: 'paid',
      label: '입금',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const r = view(r0);
        return (
          <select
            className="ak-select"
            value={r.paid ? 'Y' : 'N'}
            disabled={!canEdit}
            aria-label={`${r.customer} ${r.product} 입금 여부`}
            style={r.paid ? { color: '#047857' } : undefined}
            onChange={(e) => void commit([r.itemId], { paid: e.target.value === 'Y' })}
          >
            <option value="N">N</option>
            <option value="Y">Y</option>
          </select>
        );
      },
    },
    {
      key: 'memo',
      label: '메모',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        return (
          <input
            className="ak-input"
            style={{ width: '14rem', height: 'var(--ctl-h)' }}
            enterKeyHint="done"
            maxLength={500}
            disabled={!canEdit}
            aria-label={`${r.customer} ${r.product} 메모`}
            value={drafts[r.itemId]?.memo ?? r.memo}
            onChange={(e) => setDraft(r.itemId, 'memo', e.target.value)}
            onBlur={() => {
              const draft = drafts[r.itemId]?.memo;
              if (draft === undefined) return;
              clearDraft(r.itemId, 'memo');
              if (draft.trim() !== r.memo) void commit([r.itemId], { memo: draft });
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
  ];
  // 휴대폰에서는 고객명을 맨 앞(왼쪽 고정)에 두고, 번호 열은 뺀다. 사업자 구분은 일괄 지정을 주로 쓰므로 뒤로 보낸다.
  const MOBILE_ORDER = ['customer', 'date', 'product', 'qty', 'unitPrice', 'price', 'seller', 'paid', 'memo'];
  const shownColumns = isMobile
    ? MOBILE_ORDER.flatMap((key) => columns.filter((c) => c.key === key))
    : columns;

  return (
    <>
      <div className="ak-toolbar">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="고객명·품목 검색" />
        <span className="ak-count">{filteredRows.length}건{filteredRows.length !== rows.length ? ` / 전체 ${rows.length}건` : ''}</span>
        <span>판매가 합계 <strong>{formatWon(totalPrice)}원</strong></span>
        <span className="ak-sub">입금 Y {paidCount}건 · 판매가 미입력 {rows.length - priced.length}건</span>
        <span className="ak-spacer" />
        <span className="ak-sub" role="status" aria-live="polite">{saving > 0 ? '저장 중…' : justSaved ? '저장됨 ✓' : canEdit ? '자동 저장' : ''}</span>
        {canEdit && filteredRows.length > pageRows.length && (
          <button className="ak-btn" onClick={() => setSelected(new Set(filteredRows.map((r) => r.itemId)))}>조회된 전체 {filteredRows.length}건 선택</button>
        )}
      </div>

      {canEdit && selected.size > 0 && (
        <div className="ak-bulk ak-bulk-fixed">
          <div className="ak-bulk-head">
            <strong>{selected.size}건 선택됨</strong>
            <button className="ak-btn" onClick={() => setSelected(new Set())}>선택 해제</button>
            <button className="ak-btn ak-btn-primary" onClick={() => setReceiptOpen(true)} title="선택한 줄을 고객사 × 사업자 × 출고일로 묶어 영수증 이미지를 만듭니다">영수증 만들기</button>
            <button type="button" className="ak-btn ak-bulk-toggle" aria-expanded={bulkOpen} onClick={() => setBulkOpen((v) => !v)}>일괄 변경 {bulkOpen ? '▴' : '▾'}</button>
            <div className={`ak-bulk-extra ${bulkOpen ? 'is-open' : ''}`}>
            <select className="ak-select" value={bulkSeller} onChange={(e) => setBulkSeller(e.target.value)} title="선택한 줄에 한꺼번에 적용할 사업자 구분">
              <option value="">사업자 구분 선택</option>
              <option value={NO_SELLER}>미지정으로 되돌리기</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="ak-btn ak-btn-primary" onClick={applySeller} disabled={saving > 0 || bulkSeller === ''}>사업자 구분 적용</button>
            <select className="ak-select" value={bulkPaid} onChange={(e) => setBulkPaid(e.target.value)} title="선택한 줄에 한꺼번에 적용할 입금 여부">
              <option value="">입금 여부 선택</option>
              <option value="Y">Y (입금)</option>
              <option value="N">N (미입금)</option>
            </select>
            <button className="ak-btn ak-btn-primary" onClick={applyPaid} disabled={saving > 0 || bulkPaid === ''}>입금 여부 적용</button>
            </div>
          </div>
        </div>
      )}

      {canEdit && rows.length > 0 && <p className="ak-meta">단가를 입력하면 판매가가 비어 있을 때 단가 × 수량으로 자동 입력됩니다. 이미 입력한 판매가는 바꾸지 않습니다.</p>}
      {/* 휴대폰에서는 화면 위쪽에 고정해 표 아래쪽 줄을 입력하다가도 저장 실패·결과 안내가 보이게 한다 */}
      {error && <p className="ak-error ak-flash" role="alert">{error}</p>}
      {notice && <p className="ak-notice ak-flash" role="status">{notice}</p>}
      {sellers.length === 0 && rows.length > 0 && <p className="ak-muted">등록된 사업자가 없습니다. “사업자 관리”에서 먼저 등록하면 사업자 구분을 고를 수 있습니다.</p>}

      <DataTable
        columns={shownColumns}
        hidden={EMPTY_HIDDEN}
        rows={pageRows}
        rowKey={(r) => r.itemId}
        limitRows
        selected={canEdit ? selected : undefined}
        onToggleRow={canEdit ? toggleRow : undefined}
        onToggleAll={canEdit ? toggleAllOnPage : undefined}
        emptyText="이 기간에 출고가 끝난 주문이 없습니다."
      />

      {/* 휴대폰에서 하단에 고정된 일괄 바가 표 마지막 줄을 가리지 않게 하는 여백 */}

      {receiptOpen && (
        <ReceiptIssuePanel
          rows={viewed.filter((r) => selected.has(r.itemId))}
          sellers={sellers}
          from={from}
          to={to}
          issued={issued}
          saving={saving > 0}
          onClose={() => setReceiptOpen(false)}
        />
      )}

      {pageCount > 1 && (
        <div className="ak-toolbar" style={{ justifyContent: 'center' }}>
          <button className="ak-btn" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>이전 100줄</button>
          <span>{currentPage + 1} / {pageCount} 페이지</span>
          <button className="ak-btn" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>다음 100줄</button>
        </div>
      )}
    </>
  );
}
