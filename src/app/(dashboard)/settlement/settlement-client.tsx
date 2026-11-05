'use client';
import { useMemo, useState } from 'react';
import { saveSales, type SalesPatch } from './actions';
import { useCan } from '@/components/permissions-context';
import { DataTable, type Column } from '@/components/admin/admin-kit';
import { formatWon, formatWonInput, parseWon } from '@/lib/money';
import type { SalesRow } from '@/lib/settlement/sales';

const PAGE_SIZE = 100; // 월 조회는 수천 줄이 될 수 있어 100줄씩 나눠 보여 준다
const NO_SELLER = '__none'; // 일괄 적용에서 "미지정으로 되돌리기"
const EMPTY_HIDDEN = new Set<string>();

type Edit = Partial<Pick<SalesRow, 'sellerId' | 'price' | 'paid' | 'memo'>>;
type Drafts = Record<string, { price?: string; memo?: string }>;

export function SettlementClient({
  rows,
  sellers,
  multiDay,
}: {
  rows: SalesRow[];
  sellers: { id: string; name: string }[];
  multiDay: boolean;
}) {
  const canEdit = useCan()('settlement:edit');
  // 저장 결과를 기다리지 않고 화면에 바로 보이는 값(실패하면 되돌린다). 기간을 옮기면 화면 상태가 새로 시작된다.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [drafts, setDrafts] = useState<Drafts>({}); // 입력 중인 판매가·메모(칸을 벗어날 때 저장한다)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [bulkSeller, setBulkSeller] = useState('');
  const [bulkPaid, setBulkPaid] = useState('');
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const view = (r: SalesRow): SalesRow => ({ ...r, ...edits[r.itemId] });
  const numbered = useMemo(() => rows.map((r, i) => ({ ...r, no: i + 1 })), [rows]);
  const pageCount = Math.max(1, Math.ceil(numbered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = numbered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
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
    if (patch.paid !== undefined) local.paid = patch.paid;
    if (patch.memo !== undefined) local.memo = patch.memo ?? '';
    const previous = Object.fromEntries(ids.map((id) => [id, edits[id]]));
    setEdits((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { ...prev[id], ...local }])) }));
    setSaving((n) => n + 1);
    // 권한이 없거나 연결이 끊기면 서버 액션이 오류를 던진다. 그때도 저장 중 표시와 화면 값을 되돌린다.
    const result = await saveSales({ itemIds: ids, ...patch }).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
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

  const setDraft = (id: string, key: 'price' | 'memo', value: string) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  const clearDraft = (id: string, key: 'price' | 'memo') =>
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

  const applySeller = async () => {
    if (bulkSeller === '') return;
    const ids = [...selected];
    if (await commit(ids, { sellerId: bulkSeller === NO_SELLER ? null : bulkSeller })) {
      setNotice(`${ids.length}건의 사업자 구분을 ${bulkSeller === NO_SELLER ? '미지정으로' : `'${sellerName.get(bulkSeller)}'(으)로`} 바꿨습니다.`);
      setSelected(new Set());
    }
  };
  const applyPaid = async () => {
    if (bulkPaid === '') return;
    const ids = [...selected];
    if (await commit(ids, { paid: bulkPaid === 'Y' })) {
      setNotice(`${ids.length}건의 입금 여부를 ${bulkPaid}로 바꿨습니다.`);
      setSelected(new Set());
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
            className="ak-select"
            style={{ minWidth: '9rem' }}
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
    { key: 'customer', label: '고객명', hideable: false, render: (r) => <strong>{r.customer}</strong> },
    { key: 'product', label: '품목', hideable: false, render: (r) => r.product },
    { key: 'qty', label: '수량', hideable: false, className: 'ak-fit', render: (r) => `${formatWon(r.quantity)}${r.unit}` },
    {
      key: 'price',
      label: '판매가(원)',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        return (
          <input
            className="ak-input"
            style={{ width: '9.5rem', height: '2.1rem', textAlign: 'right' }}
            inputMode="numeric"
            placeholder="0"
            disabled={!canEdit}
            aria-label={`${r.customer} ${r.product} 판매가`}
            value={drafts[r.itemId]?.price ?? formatWon(r.price)}
            onChange={(e) => setDraft(r.itemId, 'price', formatWonInput(e.target.value))}
            onBlur={() => {
              const draft = drafts[r.itemId]?.price;
              if (draft === undefined) return;
              clearDraft(r.itemId, 'price');
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
            style={{ width: '14rem', height: '2.1rem' }}
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

  return (
    <>
      <div className="ak-toolbar">
        <span className="ak-count">{rows.length}건</span>
        <span>판매가 합계 <strong>{formatWon(totalPrice)}원</strong></span>
        <span className="ak-sub">입금 Y {paidCount}건 · 판매가 미입력 {rows.length - priced.length}건</span>
        <span className="ak-spacer" />
        {saving > 0 && <span className="ak-sub">저장 중…</span>}
        {canEdit && rows.length > pageRows.length && (
          <button className="ak-btn" onClick={() => setSelected(new Set(rows.map((r) => r.itemId)))}>조회된 전체 {rows.length}건 선택</button>
        )}
      </div>

      {canEdit && selected.size > 0 && (
        <div className="ak-bulk">
          <div className="ak-bulk-head">
            <strong>{selected.size}건 선택됨</strong>
            <button className="ak-btn" onClick={() => setSelected(new Set())}>선택 해제</button>
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
      )}

      {error && <p className="ak-error">{error}</p>}
      {notice && <p className="ak-notice">{notice}</p>}
      {sellers.length === 0 && rows.length > 0 && <p className="ak-muted">등록된 사업자가 없습니다. “사업자 관리”에서 먼저 등록하면 사업자 구분을 고를 수 있습니다.</p>}

      <DataTable
        columns={columns}
        hidden={EMPTY_HIDDEN}
        rows={pageRows}
        rowKey={(r) => r.itemId}
        selected={canEdit ? selected : undefined}
        onToggleRow={canEdit ? toggleRow : undefined}
        onToggleAll={canEdit ? toggleAllOnPage : undefined}
        emptyText="이 기간에 출고가 끝난 주문이 없습니다."
      />

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
