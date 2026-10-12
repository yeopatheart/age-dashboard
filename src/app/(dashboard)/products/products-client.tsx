'use client';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Tag, Trash2, Wand2 } from 'lucide-react';
import { createProduct, renameProduct, setProductColors, setProductMulbong, autoAssignProductColors, deleteProducts } from './actions';
import { ColorPicker } from '@/components/color-picker';
import { resolveColors } from '@/lib/color-palette';
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

export function ProductsClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [viaFilter, setViaFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState('all');
  const [mulbongFilter, setMulbongFilter] = useState('all');
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ fill: string | null; border: string | null }>({ fill: null, border: null });
  const [openId, setOpenId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const uncolored = products.map(view).filter((p) => !hasColor(p)).length;
  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return products
      .map(view)
      .filter((p) => (k ? p.name.toLowerCase().includes(k) : true))
      .filter((p) => (viaFilter === 'all' ? true : p.created_via === viaFilter))
      .filter((p) => (colorFilter === 'all' ? true : colorFilter === 'none' ? !hasColor(p) : hasColor(p)))
      .filter((p) => (mulbongFilter === 'all' ? true : mulbongFilter === 'yes' ? p.needs_mulbong : !p.needs_mulbong));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, local, localMulbong, search, viaFilter, colorFilter, mulbongFilter]);
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
    router.refresh();
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
    router.refresh();
  };
  const handleColor = async (p: Product, fill: string | null, border: string | null) => {
    setLocal((prev) => ({ ...prev, [p.id]: { fill, border } }));
    await setProductColors([p.id], fill, border);
    router.refresh();
  };
  const handleMulbong = async (ids: string[], value: boolean) => {
    setLocalMulbong((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, value])) }));
    await setProductMulbong(ids, value);
    router.refresh();
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    const all = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
    setSelected(all ? new Set() : new Set(filtered.map((p) => p.id)));
  };
  const applyBulk = async () => {
    const ids = [...selected];
    const ok = await run(() => setProductColors(ids, bulk.fill, bulk.border), `${ids.length}개 상품에 색을 적용했습니다.`);
    if (ok) {
      setLocal((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { fill: bulk.fill, border: bulk.border }])) }));
      setSelected(new Set());
    }
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
    router.refresh();
  };

  const columns: Column<Product>[] = [
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
      render: (p) => <Toggle checked={p.needs_mulbong} onChange={(v) => handleMulbong([p.id], v)} label={`${p.name} 물봉 포장`} />,
    },
    { key: 'via', label: '등록', render: (p) => <ViaTag via={p.created_via} date={p.created_at} /> },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<Tag size={20} />} title="상품 관리" sub="상품마다 '품목별 수량' 칩의 안쪽색과 테두리색을 정합니다. 주문 입력에서 처음 나온 상품은 겹치지 않는 색으로 자동 등록됩니다." />

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
        <FilterSelect
          value={viaFilter}
          onChange={setViaFilter}
          options={[{ value: 'all', label: '등록: 전체' }, { value: 'order', label: '주문입력' }, { value: 'manual', label: '수기입력' }]}
        />
        <span className="ak-count">{filtered.length}개{filtered.length !== products.length ? ` / 전체 ${products.length}개` : ''}</span>
        <span className="ak-spacer" />
        <button className="ak-btn" onClick={handleAuto} disabled={busy || uncolored === 0} title="색이 없는 상품에 겹치지 않는 색을 자동으로 배정합니다">
          <Wand2 size={14} /> 색상 자동 배정 ({uncolored})
        </button>
        <div className="ak-quick-add">
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
        </div>
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
      </div>

      {selected.size > 0 && (
        <div className="ak-bulk">
          <div className="ak-bulk-head">
            <strong>{selected.size}개 선택됨</strong>
            <button className="ak-btn" onClick={() => setSelected(new Set())}>선택 해제</button>
            <button className="ak-btn ak-btn-primary" onClick={applyBulk} disabled={busy}>선택한 상품에 색 적용</button>
            <button className="ak-btn" onClick={() => handleMulbong([...selected], true)} disabled={busy}>물봉 포장 지정</button>
            <button className="ak-btn" onClick={() => handleMulbong([...selected], false)} disabled={busy}>물봉 해제</button>
            <span className="ak-spacer" />
            <button
              className="ak-btn ak-btn-danger"
              disabled={busy}
              onClick={() => run(async () => {
                const r = await deleteProducts([...selected]);
                setSelected(new Set());
                return r;
              })}
            >
              <Trash2 size={14} /> 삭제
            </button>
          </div>
          <ColorPicker fill={bulk.fill} border={bulk.border} onChange={(f, b) => setBulk({ fill: f, border: b })} sample="일괄 적용 미리보기" />
        </div>
      )}

      {error && !open && <p className="ak-error">{error}</p>}
      {notice && <p className="ak-notice">{notice}</p>}

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
          footer={
            confirmDelete ? (
              <>
                <span className="ak-error" style={{ flex: 1 }}>정말 삭제할까요? 이미 들어온 주문은 그대로 남습니다.</span>
                <button className="ak-btn" onClick={() => setConfirmDelete(false)}>취소</button>
                <button
                  className="ak-btn ak-btn-primary"
                  style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => deleteProducts([open.id]))) setOpenId(null);
                  }}
                >삭제</button>
              </>
            ) : (
              <>
                <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setOpenId(null)}>닫기</button>
                <button
                  className="ak-btn ak-btn-primary"
                  disabled={busy || !nameDraft.trim() || nameDraft.trim() === open.name}
                  onClick={handleRename}
                >이름 저장</button>
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
            <span className="ak-meta">이름을 바꾸면 이 상품의 과거 주문 상품명도 함께 바뀝니다. 박스 기록은 당시 이름 그대로 남습니다.</span>
          </div>
          <div className="ak-setting">
            <span>
              물봉 포장 필요
              <small>켜두면 이 상품은 물봉용 박스에 담아야 하는 상품으로 취급됩니다</small>
            </span>
            <Toggle checked={open.needs_mulbong} onChange={(v) => handleMulbong([open.id], v)} label="물봉 포장 필요" />
          </div>
          <div className="ak-field">
            <span className="ak-field-label">색상 (누르면 바로 저장됩니다)</span>
            <ColorPicker fill={open.fill_color} border={open.border_color} onChange={(f, b) => handleColor(open, f, b)} sample={open.name} />
          </div>
          <p className="ak-meta">{open.created_via === 'order' ? '주문입력' : '수기입력'}으로 {open.created_at.slice(0, 10).replace(/-/g, '.')} 등록</p>
          {error && <p className="ak-error">{error}</p>}
          {notice && <p className="ak-notice">{notice}</p>}
        </SidePanel>
      )}
    </div>
  );
}
