'use client';
import { useMemo, useRef, useState } from 'react';
import { Plus, Store, Tag, Trash2, Wand2, X } from 'lucide-react';
import { createProduct, renameProduct, setProductColors, setProductMulbong, setProductsSupplier, autoAssignProductColors, deleteProducts } from './actions';
import { SupplierPanel, type Supplier } from './supplier-panel';
import { MigrationNotice } from '@/components/migration-notice';
import { ColorPicker } from '@/components/color-picker';
import { resolveColors } from '@/lib/color-palette';
import { useCan } from '@/components/permissions-context';
import {
  AdminHeader,
  ColumnMenu,
  DataTable,
  FilterSelect,
  SearchInput,
  SidePanel,
  Toggle,
  ViaTag,
  useHiddenColumns,
  type Column,
  DeleteFooter,
  useNotice,
} from '@/components/admin/admin-kit';

interface Product {
  id: string;
  name: string;
  created_at: string;
  created_via: 'order' | 'manual';
  fill_color: string | null;
  border_color: string | null;
  needs_mulbong: boolean;
}

export function ProductsClient({
  products,
  suppliers,
  links,
  suppliersReady,
  missingMigrations,
}: {
  products: Product[];
  suppliers: Supplier[];
  links: { product_id: string; supplier_id: string }[];
  suppliersReady: boolean; // false면 매입처 테이블(마이그레이션 0042)이 아직 없다: 매입처 기능만 끄고 안내를 보여 준다
  missingMigrations: string[];
}) {
  const can = useCan();
  const canEdit = can('products:edit');
  const canDelete = can('products:delete');
  const [search, setSearch] = useState('');
  const [viaFilter, setViaFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState('all');
  const [mulbongFilter, setMulbongFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [bulkSupplierId, setBulkSupplierId] = useState('');
  const [addSupplierId, setAddSupplierId] = useState('');
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulk, setBulk] = useState<{ fill: string | null; border: string | null }>({ fill: null, border: null });
  const [openId, setOpenId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useHiddenColumns('ak-cols-products');
  // 색 선택은 누르는 즉시 저장하고 화면에도 바로 반영한다.
  const [local, setLocal] = useState<Record<string, { fill: string | null; border: string | null }>>({});
  const [localMulbong, setLocalMulbong] = useState<Record<string, boolean>>({});

  const view = (p: Product): Product => {
    const l = local[p.id];
    const withColor = l ? { ...p, fill_color: l.fill, border_color: l.border } : p;
    return p.id in localMulbong ? { ...withColor, needs_mulbong: localMulbong[p.id] } : withColor;
  };
  const hasColor = (p: Product) => !!(p.fill_color || p.border_color);
  // 상품 → 매입처 id 목록, 매입처 id → 이름·연결된 상품 수
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const suppliersOfProduct = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) m.set(l.product_id, [...(m.get(l.product_id) ?? []), l.supplier_id]);
    return m;
  }, [links]);
  const productCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of links) counts[l.supplier_id] = (counts[l.supplier_id] ?? 0) + 1;
    return counts;
  }, [links]);
  const uncolored = products.map(view).filter((p) => !hasColor(p)).length;
  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return products
      .map(view)
      .filter((p) => (k ? p.name.toLowerCase().includes(k) : true))
      .filter((p) => (viaFilter === 'all' ? true : p.created_via === viaFilter))
      .filter((p) => (colorFilter === 'all' ? true : colorFilter === 'none' ? !hasColor(p) : hasColor(p)))
      .filter((p) => (mulbongFilter === 'all' ? true : mulbongFilter === 'yes' ? p.needs_mulbong : !p.needs_mulbong))
      .filter((p) => {
        if (supplierFilter === 'all') return true;
        const ids = suppliersOfProduct.get(p.id) ?? [];
        return supplierFilter === 'none' ? ids.length === 0 : ids.includes(supplierFilter);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, local, localMulbong, search, viaFilter, colorFilter, mulbongFilter, supplierFilter, suppliersOfProduct]);
  const open = openId ? products.map(view).find((p) => p.id === openId) ?? null : null;

  const run = async (fn: () => Promise<{ error: string | null }>, okNotice?: string) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await fn();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    if (okNotice) setNotice(okNotice);
    return true;
  };

  const addInputRef = useRef<HTMLInputElement>(null);
  const handleAdd = async () => {
    // 비어 있으면 버튼을 비활성(회색)으로 두지 않고 입력창으로 안내한다 — 다른 관리 화면의 추가 버튼과 같은 모양을 유지한다.
    if (!newName.trim()) {
      addInputRef.current?.focus();
      return;
    }
    if (await run(() => createProduct(newName, null, null))) setNewName('');
  };
  const handleRename = async () => {
    if (!open || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await renameProduct(open.id, nameDraft);
    setBusy(false);
    if (result.error) return setError(result.error);
    setNotice(`'${nameDraft.trim()}'(으)로 바꿨습니다.${result.updatedItems > 0 ? ` 과거 주문 ${result.updatedItems}건도 함께 바뀌었습니다.` : ''}`);
  };
  const handleColor = async (p: Product, fill: string | null, border: string | null) => {
    setLocal((prev) => ({ ...prev, [p.id]: { fill, border } }));
    await setProductColors([p.id], fill, border);
  };
  const handleMulbong = async (ids: string[], value: boolean) => {
    setLocalMulbong((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, value])) }));
    await setProductMulbong(ids, value);
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // 일괄 작업은 지금 화면에 보이는 선택만 대상으로 한다(검색·필터를 바꿔 안 보이게 된 선택이 몰래 삭제·변경되지 않게).
  const selectedIds = useMemo(() => filtered.filter((p) => selected.has(p.id)).map((p) => p.id), [filtered, selected]);
  const hiddenSelected = selected.size - selectedIds.length;
  const toggleAll = () => {
    const all = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
    setSelected(all ? new Set() : new Set(filtered.map((p) => p.id)));
  };
  const applyBulk = async () => {
    const ids = selectedIds;
    const ok = await run(() => setProductColors(ids, bulk.fill, bulk.border), `${ids.length}개 상품에 색을 적용했습니다.`);
    if (ok) {
      setLocal((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { fill: bulk.fill, border: bulk.border }])) }));
      setSelected(new Set());
    }
  };
  // 상품 여러 개에 매입처 하나를 추가·제거한다(선택한 상품 일괄, 상세 패널에서는 상품 하나).
  const handleSupplier = async (ids: string[], supplierId: string, mode: 'add' | 'remove') => {
    if (!supplierId || ids.length === 0) return false;
    const name = supplierName.get(supplierId) ?? '';
    return run(() => setProductsSupplier(ids, supplierId, mode), `${ids.length}개 상품에 매입처 '${name}'을(를) ${mode === 'add' ? '추가' : '제거'}했습니다.`);
  };
  const handleAuto = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await autoAssignProductColors();
    setBusy(false);
    if (result.error) return setError(result.error);
    setLocal({});
    setNotice(`색이 없는 상품 ${result.assigned}개에 겹치지 않는 색을 배정했습니다.`);
  };

  const allColumns: Column<Product>[] = [
    {
      key: 'name',
      label: '상품',
      hideable: false,
      render: (p) => {
        const c = resolveColors(p.fill_color, p.border_color);
        return <span className="ak-pill" style={{ backgroundColor: c.fill, borderColor: c.border, color: c.text }}>{p.name}</span>;
      },
    },
    {
      key: 'color',
      label: '색상',
      render: (p) =>
        hasColor(p) ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <span className="ak-swatch" style={{ backgroundColor: resolveColors(p.fill_color, null).fill, borderColor: resolveColors(null, p.border_color).border }} title="안쪽색" />
            <span className="ak-swatch" style={{ backgroundColor: resolveColors(null, p.border_color).border, borderColor: resolveColors(null, p.border_color).border }} title="테두리색" />
          </span>
        ) : (
          <span className="ak-muted">미지정</span>
        ),
    },
    {
      key: 'mulbong',
      label: '물봉 포장',
      render: (p) => <Toggle checked={p.needs_mulbong} onChange={(v) => handleMulbong([p.id], v)} label={`${p.name} 물봉 포장`} disabled={!canEdit} />,
    },
    {
      key: 'suppliers',
      label: '매입처',
      render: (p) => {
        const ids = suppliersOfProduct.get(p.id) ?? [];
        return ids.length === 0 ? (
          <span className="ak-muted">미지정</span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {ids.map((id) => <span key={id} className="ak-tag ak-tag-manual">{supplierName.get(id) ?? '-'}</span>)}
          </span>
        );
      },
    },
    { key: 'via', label: '등록', render: (p) => <ViaTag via={p.created_via} date={p.created_at} /> },
  ];
  const columns = suppliersReady ? allColumns : allColumns.filter((c) => c.key !== 'suppliers');

  return (
    <div className="ak-page">
      <AdminHeader icon={<Tag size={20} />} title="상품 관리" sub="상품마다 '품목별 수량' 칩의 안쪽색과 테두리색을 정합니다. 주문 입력에서 처음 나온 상품은 겹치지 않는 색으로 자동 등록됩니다." />

      {!suppliersReady && <MigrationNotice feature="매입처 기능" migrations={missingMigrations} />}

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="상품 검색" />
        <FilterSelect
          value={colorFilter}
          onChange={setColorFilter}
          options={[{ value: 'all', label: '색상: 전체' }, { value: 'set', label: '지정됨' }, { value: 'none', label: '미지정' }]}
        />
        <FilterSelect
          value={mulbongFilter}
          onChange={setMulbongFilter}
          options={[{ value: 'all', label: '물봉: 전체' }, { value: 'yes', label: '물봉 포장 필요' }, { value: 'no', label: '불필요' }]}
        />
        {suppliersReady && (
          <FilterSelect
            value={supplierFilter}
            onChange={setSupplierFilter}
            options={[{ value: 'all', label: '매입처: 전체' }, { value: 'none', label: '미지정' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
        <FilterSelect
          value={viaFilter}
          onChange={setViaFilter}
          options={[{ value: 'all', label: '등록: 전체' }, { value: 'order', label: '주문입력' }, { value: 'manual', label: '수기입력' }]}
        />
        <span className="ak-count">{filtered.length}개{filtered.length !== products.length ? ` / 전체 ${products.length}개` : ''}</span>
        <span className="ak-spacer" />
        {canEdit && <button className="ak-btn" onClick={handleAuto} disabled={busy || uncolored === 0} title="색이 없는 상품에 겹치지 않는 색을 자동으로 배정합니다">
          <Wand2 size={14} /> 색상 자동 배정 ({uncolored})
        </button>}
        {canEdit && <div className="ak-quick-add">
          <input
            ref={addInputRef}
            placeholder="새 상품 (예: 활전갱이)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <button className="ak-btn ak-btn-primary" onClick={handleAdd} disabled={busy}>
            <Plus size={14} /> 추가
          </button>
        </div>}
        {suppliersReady && <button className="ak-btn" onClick={() => setSuppliersOpen(true)}><Store size={14} /> 매입처 관리 ({suppliers.length})</button>}
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
      </div>

      {canEdit && selectedIds.length > 0 && (
        <div className="ak-bulk">
          <div className="ak-bulk-head">
            <strong>{selectedIds.length}개 선택됨</strong>
            {hiddenSelected > 0 && <span className="ak-meta">(화면에 안 보이는 선택 {hiddenSelected}개는 제외됩니다)</span>}
            <button className="ak-btn" onClick={() => { setSelected(new Set()); setConfirmBulkDelete(false); }}>선택 해제</button>
            <button className="ak-btn ak-btn-primary" onClick={applyBulk} disabled={busy}>선택한 상품에 색 적용</button>
            <button className="ak-btn" onClick={() => handleMulbong(selectedIds, true)} disabled={busy}>물봉 포장 지정</button>
            <button className="ak-btn" onClick={() => handleMulbong(selectedIds, false)} disabled={busy}>물봉 해제</button>
            {suppliersReady && (
              <>
              <select className="ak-select" value={bulkSupplierId} onChange={(e) => setBulkSupplierId(e.target.value)} title="선택한 상품에 추가·제거할 매입처">
                <option value="">매입처 선택</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="ak-btn" onClick={() => handleSupplier(selectedIds, bulkSupplierId, 'add')} disabled={busy || !bulkSupplierId}>매입처 추가</button>
              <button className="ak-btn" onClick={() => handleSupplier(selectedIds, bulkSupplierId, 'remove')} disabled={busy || !bulkSupplierId}>매입처 제거</button>
              </>
            )}
            <span className="ak-spacer" />
            {canDelete && (confirmBulkDelete ? (
              <>
                <span className="ak-error">선택한 {selectedIds.length}개를 삭제할까요? 이미 들어온 주문은 그대로 남습니다.</span>
                <button className="ak-btn" onClick={() => setConfirmBulkDelete(false)} disabled={busy}>취소</button>
                <button
                  className="ak-btn ak-btn-primary"
                  style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                  disabled={busy}
                  onClick={() => run(async () => {
                    const r = await deleteProducts(selectedIds);
                    setSelected(new Set());
                    setConfirmBulkDelete(false);
                    return r;
                  })}
                >
                  {selectedIds.length}개 삭제
                </button>
              </>
            ) : (
              <button className="ak-btn ak-btn-danger" disabled={busy} onClick={() => setConfirmBulkDelete(true)}>
                <Trash2 size={14} /> 삭제
              </button>
            ))}
          </div>
          <ColorPicker fill={bulk.fill} border={bulk.border} onChange={(f, b) => setBulk({ fill: f, border: b })} sample="일괄 적용 미리보기" />
        </div>
      )}

      {error && !open && <p className="ak-error" role="alert">{error}</p>}
      {notice && <p className="ak-notice" role="status">{notice}</p>}

      <DataTable
        columns={columns}
        hidden={hidden}
        rows={filtered}
        rowKey={(p) => p.id}
        onRowClick={(p) => {
          setOpenId(p.id);
          setNameDraft(p.name);
          setConfirmDelete(false);
          setError(null);
        }}
        activeKey={openId}
        selected={selected}
        onToggleRow={toggle}
        onToggleAll={toggleAll}
        emptyText={products.length === 0 ? '등록된 상품이 없습니다.' : '조건에 맞는 상품이 없습니다.'}
      />

      {open && (
        <SidePanel
          title="상품 상세"
          onClose={() => setOpenId(null)}
          dirty={canEdit && nameDraft !== open.name}
          readOnly={!canEdit}
          footer={
            confirmDelete ? (
              <DeleteFooter
                name={open.name}
                consequence="이미 들어온 주문은 그대로 남습니다."
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  if (await run(() => deleteProducts([open.id]))) setOpenId(null);
                }}
              />
            ) : (
              <>
                {canDelete && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setOpenId(null)}>닫기</button>
                {canEdit && <button
                  className="ak-btn ak-btn-primary"
                  disabled={busy || !nameDraft.trim() || nameDraft.trim() === open.name}
                  onClick={handleRename}
                >이름 저장</button>}
              </>
            )
          }
        >
          <div className="ak-field">
            <label>상품명</label>
            <input
              className="ak-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && nameDraft.trim() && nameDraft.trim() !== open.name && handleRename()}
            />
            <span className="ak-meta">이름을 바꾸면 이 상품의 과거 주문 상품명도 함께 바뀝니다. 박스 할당 기록은 당시 이름 그대로 남습니다.</span>
          </div>
          <div className="ak-setting">
            <span>
              물봉 포장 필요
              <small>켜두면 이 상품은 물봉용 박스에 담아야 하는 상품으로 취급됩니다</small>
            </span>
            <Toggle checked={open.needs_mulbong} onChange={(v) => handleMulbong([open.id], v)} label="물봉 포장 필요" disabled={!canEdit} />
          </div>
          {suppliersReady && (
            <div className="ak-field">
              <span className="ak-field-label">매입처</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(suppliersOfProduct.get(open.id) ?? []).length === 0 && <span className="ak-muted">지정된 매입처가 없습니다</span>}
                {(suppliersOfProduct.get(open.id) ?? []).map((id) => (
                  <span key={id} className="ak-tag ak-tag-manual" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {supplierName.get(id) ?? '-'}
                    {canEdit && <button type="button" aria-label={`${supplierName.get(id)} 제거`} disabled={busy} onClick={() => handleSupplier([open.id], id, 'remove')} style={{ display: 'inline-flex', cursor: 'pointer' }}><X size={12} /></button>}
                  </span>
                ))}
              </span>
              {canEdit && (
                <span style={{ display: 'flex', gap: 6 }}>
                  <select className="ak-select" value={addSupplierId} onChange={(e) => setAddSupplierId(e.target.value)}>
                    <option value="">매입처 선택</option>
                    {suppliers.filter((s) => !(suppliersOfProduct.get(open.id) ?? []).includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button
                    className="ak-btn"
                    disabled={busy || !addSupplierId}
                    onClick={async () => {
                      if (await handleSupplier([open.id], addSupplierId, 'add')) setAddSupplierId('');
                    }}
                  >추가</button>
                </span>
              )}
              <span className="ak-meta">정산의 매입내역에서 이 상품의 매입처를 이 목록에서 고릅니다. 매입처 자체는 위의 “매입처 관리”에서 등록합니다.</span>
            </div>
          )}
          <div className="ak-field">
            <span className="ak-field-label">색상 (누르면 바로 저장됩니다)</span>
            <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><ColorPicker fill={open.fill_color} border={open.border_color} onChange={(f, b) => handleColor(open, f, b)} sample={open.name} /></fieldset>
          </div>
          <p className="ak-meta">{open.created_via === 'order' ? '주문입력' : '수기입력'}으로 {open.created_at.slice(0, 10).replace(/-/g, '.')} 등록</p>
          {error && <p className="ak-error" role="alert">{error}</p>}
          {notice && <p className="ak-notice" role="status">{notice}</p>}
        </SidePanel>
      )}

      {suppliersOpen && <SupplierPanel suppliers={suppliers} productCounts={productCounts} canEdit={canEdit} canDelete={canDelete} onClose={() => setSuppliersOpen(false)} />}
    </div>
  );
}
