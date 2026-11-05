'use client';
import { useMemo, useState } from 'react';
import { savePurchases, type PurchasePatch } from './actions';
import { useCan } from '@/components/permissions-context';
import { DataTable, type Column } from '@/components/admin/admin-kit';
import { formatWon, formatWonInput, parseWon } from '@/lib/money';
import { profitOf, totalsOf, type PurchaseRow } from '@/lib/settlement/purchases';

const PAGE_SIZE = 100; // 월 조회는 행이 많을 수 있어 100줄씩 나눠 보여 준다
const NO_SELLER = '__none'; // 일괄 적용에서 "미지정으로 되돌리기"
const EMPTY_HIDDEN = new Set<string>();

type Edit = Partial<Pick<PurchaseRow, 'sellerId' | 'supplierId' | 'price' | 'paid' | 'memo'>>;
type Drafts = Record<string, { price?: string; memo?: string }>;
type Option = { id: string; name: string };

export function PurchasesClient({
  rows,
  sellers,
  suppliers,
  supplierIdsByProduct,
  multiDay,
}: {
  rows: PurchaseRow[];
  sellers: Option[];
  suppliers: Option[]; // 전체 매입처(이름 표시용)
  supplierIdsByProduct: Record<string, string[]>; // 품목(상품명) → 그 상품에 연결된 매입처 id
  multiDay: boolean;
}) {
  const canEdit = useCan()('settlement:edit');
  // 저장 결과를 기다리지 않고 화면에 바로 보이는 값(실패하면 되돌린다). 기간을 옮기면 화면 상태가 새로 시작된다.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [drafts, setDrafts] = useState<Drafts>({}); // 입력 중인 매입가·메모(칸을 벗어날 때 저장한다)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [bulkSeller, setBulkSeller] = useState('');
  const [bulkPaid, setBulkPaid] = useState('');
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const view = (r: PurchaseRow): PurchaseRow => ({ ...r, ...edits[r.key] });
  const numbered = useMemo(() => rows.map((r, i) => ({ ...r, no: i + 1 })), [rows]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const pageCount = Math.max(1, Math.ceil(numbered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = numbered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const sellerName = new Map(sellers.map((s) => [s.id, s.name]));
  const totals = totalsOf(numbered.map(view));

  // 하나 또는 여러 행의 값을 바꾼다. 화면에 먼저 반영하고 서버에 저장하며, 실패하면 이전 값으로 되돌린다.
  const commit = async (keys: string[], patch: Omit<PurchasePatch, 'targets'>): Promise<boolean> => {
    const targets = keys.flatMap((k) => {
      const r = rowByKey.get(k);
      return r ? [{ orderDate: r.orderDate, productName: r.product }] : [];
    });
    if (targets.length === 0) return false;
    setError(null);
    setNotice(null);
    const local: Edit = {};
    if (patch.sellerId !== undefined) local.sellerId = patch.sellerId;
    if (patch.supplierId !== undefined) local.supplierId = patch.supplierId;
    if (patch.price !== undefined) local.price = patch.price;
    if (patch.paid !== undefined) local.paid = patch.paid;
    if (patch.memo !== undefined) local.memo = patch.memo ?? '';
    const previous = Object.fromEntries(keys.map((k) => [k, edits[k]]));
    setEdits((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, { ...prev[k], ...local }])) }));
    setSaving((n) => n + 1);
    // 권한이 없거나 연결이 끊기면 서버 액션이 오류를 던진다. 그때도 저장 중 표시와 화면 값을 되돌린다.
    const result = await savePurchases({ targets, ...patch }).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
    if (result.error) {
      setEdits((prev) => {
        const next = { ...prev };
        for (const k of keys) {
          if (previous[k]) next[k] = previous[k];
          else delete next[k];
        }
        return next;
      });
      setError(result.error);
      return false;
    }
    return true;
  };

  const setDraft = (key: string, field: 'price' | 'memo', value: string) => setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const clearDraft = (key: string, field: 'price' | 'memo') =>
    setDrafts((prev) => {
      const { [field]: _removed, ...rest } = prev[key] ?? {};
      void _removed;
      return { ...prev, [key]: rest };
    });

  const toggleRow = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAllOnPage = () => {
    const all = pageRows.length > 0 && pageRows.every((r) => selected.has(r.key));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (all) next.delete(r.key);
        else next.add(r.key);
      }
      return next;
    });
  };

  const applySeller = async () => {
    if (bulkSeller === '') return;
    const keys = [...selected];
    if (await commit(keys, { sellerId: bulkSeller === NO_SELLER ? null : bulkSeller })) {
      setNotice(`${keys.length}건의 사업자 구분을 ${bulkSeller === NO_SELLER ? '미지정으로' : `'${sellerName.get(bulkSeller)}'(으)로`} 바꿨습니다.`);
      setSelected(new Set());
    }
  };
  const applyPaid = async () => {
    if (bulkPaid === '') return;
    const keys = [...selected];
    if (await commit(keys, { paid: bulkPaid === 'Y' })) {
      setNotice(`${keys.length}건의 입금 여부를 ${bulkPaid}로 바꿨습니다.`);
      setSelected(new Set());
    }
  };

  // 이 품목의 매입처 선택지: 상품 관리에서 연결한 매입처 + (연결이 풀렸어도) 이미 고른 매입처
  const supplierOptions = (r: PurchaseRow): { id: string; label: string }[] => {
    const linked = (supplierIdsByProduct[r.product] ?? []).flatMap((id) => (supplierName.has(id) ? [{ id, label: supplierName.get(id)! }] : []));
    if (r.supplierId && !linked.some((o) => o.id === r.supplierId)) linked.push({ id: r.supplierId, label: `${supplierName.get(r.supplierId) ?? '삭제된 매입처'} (연결 해제됨)` });
    return linked;
  };

  const columns: Column<PurchaseRow & { no: number }>[] = [
    { key: 'no', label: '번호', hideable: false, className: 'ak-fit', render: (r) => r.no },
    ...(multiDay ? [{ key: 'date', label: '출고일', hideable: false, className: 'ak-fit', render: (r: PurchaseRow) => r.orderDate.slice(5).replace('-', '.') } satisfies Column<PurchaseRow & { no: number }>] : []),
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
            aria-label={`${r.product} 사업자 구분`}
            onChange={(e) => void commit([r.key], { sellerId: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">미지정</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      },
    },
    { key: 'product', label: '품목', hideable: false, render: (r) => <strong>{r.product}</strong> },
    {
      key: 'supplier',
      label: '매입처',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        const options = supplierOptions(r);
        return (
          <select
            className="ak-select"
            style={{ minWidth: '9rem' }}
            value={r.supplierId ?? ''}
            disabled={!canEdit || options.length === 0}
            title={options.length === 0 ? '상품 관리에서 이 상품의 매입처를 먼저 등록하세요' : undefined}
            aria-label={`${r.product} 매입처`}
            onChange={(e) => void commit([r.key], { supplierId: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">{options.length === 0 ? '등록된 매입처 없음' : '선택'}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        );
      },
    },
    {
      key: 'price',
      label: '매입가(원)',
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
            aria-label={`${r.product} 매입가`}
            value={drafts[r.key]?.price ?? formatWon(r.price)}
            onChange={(e) => setDraft(r.key, 'price', formatWonInput(e.target.value))}
            onBlur={() => {
              const draft = drafts[r.key]?.price;
              if (draft === undefined) return;
              clearDraft(r.key, 'price');
              const next = parseWon(draft);
              if (next !== r.price) void commit([r.key], { price: next });
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    {
      key: 'sales',
      label: '총 판매가(원)',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const r = view(r0);
        if (r.salesCount === 0) return <span className="ak-muted" title="지금 판매내역에 이 품목이 없습니다">-</span>;
        const missing = r.salesCount - r.salesPriced;
        return (
          <span style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end', width: '100%' }} title={missing > 0 ? `판매가를 입력하지 않은 판매내역 ${missing}건은 합계에 들어가지 않았습니다` : undefined}>
            {missing > 0 && <span style={{ color: '#b45309' }} aria-label="판매가 일부 미입력">⚠</span>}
            {formatWon(r.salesTotal)}
          </span>
        );
      },
    },
    {
      key: 'profit',
      label: '수익(원)',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const profit = profitOf(view(r0));
        if (profit === null) return <span className="ak-muted" title="매입가를 입력하면 계산됩니다">-</span>;
        return <strong style={{ color: profit < 0 ? '#b91c1c' : undefined, display: 'block', textAlign: 'right' }}>{formatWon(profit)}</strong>;
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
            aria-label={`${r.product} 입금 여부`}
            style={r.paid ? { color: '#047857' } : undefined}
            onChange={(e) => void commit([r.key], { paid: e.target.value === 'Y' })}
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
            aria-label={`${r.product} 메모`}
            value={drafts[r.key]?.memo ?? r.memo}
            onChange={(e) => setDraft(r.key, 'memo', e.target.value)}
            onBlur={() => {
              const draft = drafts[r.key]?.memo;
              if (draft === undefined) return;
              clearDraft(r.key, 'memo');
              if (draft.trim() !== r.memo) void commit([r.key], { memo: draft });
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
        <span className="ak-count">품목 {totals.rows}개</span>
        <span>총 매입가 <strong>{formatWon(totals.purchaseTotal)}원</strong></span>
        <span>총 판매가 <strong>{formatWon(totals.salesTotal)}원</strong></span>
        <span>총 수익 <strong style={{ color: totals.profitTotal < 0 ? '#b91c1c' : undefined }}>{formatWon(totals.profitTotal)}원</strong></span>
        <span className="ak-spacer" />
        {saving > 0 && <span className="ak-sub">저장 중…</span>}
        {canEdit && rows.length > pageRows.length && (
          <button className="ak-btn" onClick={() => setSelected(new Set(rows.map((r) => r.key)))}>조회된 전체 {rows.length}건 선택</button>
        )}
      </div>
      {(totals.missingPrice > 0 || totals.partialSales > 0) && (
        <p className="ak-sub" style={{ margin: 0 }}>
          {totals.missingPrice > 0 && <>매입가 미입력 <strong>{totals.missingPrice}건</strong>은 수익과 총 수익에서 뺐습니다. </>}
          {totals.partialSales > 0 && <>판매가를 일부만 입력한 품목 {totals.partialSales}건은 총 판매가가 덜 잡혔습니다(⚠).</>}
        </p>
      )}

      {canEdit && selected.size > 0 && (
        <div className="ak-bulk">
          <div className="ak-bulk-head">
            <strong>{selected.size}건 선택됨</strong>
            <button className="ak-btn" onClick={() => setSelected(new Set())}>선택 해제</button>
            <select className="ak-select" value={bulkSeller} onChange={(e) => setBulkSeller(e.target.value)} title="선택한 행에 한꺼번에 적용할 사업자 구분">
              <option value="">사업자 구분 선택</option>
              <option value={NO_SELLER}>미지정으로 되돌리기</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="ak-btn ak-btn-primary" onClick={applySeller} disabled={saving > 0 || bulkSeller === ''}>사업자 구분 적용</button>
            <select className="ak-select" value={bulkPaid} onChange={(e) => setBulkPaid(e.target.value)} title="선택한 행에 한꺼번에 적용할 입금 여부">
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
        rowKey={(r) => r.key}
        selected={canEdit ? selected : undefined}
        onToggleRow={canEdit ? toggleRow : undefined}
        onToggleAll={canEdit ? toggleAllOnPage : undefined}
        emptyText="이 기간에 매입내역이 없습니다. 판매내역이 올라오면 품목이 자동으로 추가됩니다."
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
