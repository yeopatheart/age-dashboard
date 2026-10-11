'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Tag, Search, Wand2 } from 'lucide-react';
import { createProduct, setProductColors, autoAssignProductColors, deleteProducts } from './actions';
import { ColorPicker } from '@/components/color-picker';
import { resolveColors } from '@/lib/color-palette';

interface Product {
  id: string;
  name: string;
  created_at: string;
  created_via: 'order' | 'manual';
  fill_color: string | null;
  border_color: string | null;
}

const formatDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '.');

export function ProductsClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ fill: string | null; border: string | null }>({ fill: null, border: null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 색 선택은 누르는 즉시 저장하고 화면에도 바로 반영한다.
  const [localColors, setLocalColors] = useState<Record<string, { fill: string | null; border: string | null }>>({});

  const colorOf = (p: Product) => localColors[p.id] ?? { fill: p.fill_color, border: p.border_color };
  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return k ? products.filter((p) => p.name.toLowerCase().includes(k)) : products;
  }, [products, search]);
  const uncolored = products.filter((p) => !colorOf(p).fill && !colorOf(p).border).length;

  const run = async (fn: () => Promise<{ error: string | null }>, okNotice?: string) => {
    if (busy) return;
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

  const handleAdd = async () => {
    if (!newName.trim()) return;
    if (await run(() => createProduct(newName, null, null))) setNewName('');
  };

  const handleColor = async (p: Product, fill: string | null, border: string | null) => {
    setLocalColors((prev) => ({ ...prev, [p.id]: { fill, border } }));
    await setProductColors([p.id], fill, border);
    router.refresh();
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const applyBulk = async () => {
    const ids = [...selected];
    const ok = await run(() => setProductColors(ids, bulk.fill, bulk.border), `${ids.length}개 상품에 색을 적용했습니다.`);
    if (ok) {
      setLocalColors((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, { fill: bulk.fill, border: bulk.border }])) }));
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
    setLocalColors({});
    setNotice(`색이 없는 상품 ${result.assigned}개에 겹치지 않는 색을 배정했습니다.`);
    router.refresh();
  };

  return (
    <div className="products-root">
      <div className="page-header">
        <div className="page-header-icon"><Tag size={20} /></div>
        <div>
          <h1 className="page-title">상품 관리</h1>
          <p className="page-sub">상품마다 대시보드 팁의 안쪽색과 테두리색을 정합니다. 주문 입력에서 처음 나온 상품은 겹치지 않는 색으로 자동 등록됩니다.</p>
        </div>
      </div>

      <div className="add-card">
        <div className="add-row">
          <input
            className="input-field"
            placeholder="상품명 (예: 활전갱이) — 색은 겹치지 않게 자동 배정됩니다"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <button className="btn-primary add-btn" onClick={handleAdd} disabled={busy || !newName.trim()}>
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      <div className="tool-row">
        <div className="search-box">
          <Search size={14} />
          <input placeholder="상품 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="count-text">{filtered.length}개{search ? ` / 전체 ${products.length}개` : ''}</span>
        <button className="auto-btn" onClick={handleAuto} disabled={busy || uncolored === 0}>
          <Wand2 size={14} /> 색상 자동 배정 ({uncolored}개)
        </button>
      </div>

      {selected.size > 0 && (
        <div className="bulk-card">
          <div className="bulk-head">
            <strong>{selected.size}개 선택됨</strong>
            <button className="bulk-clear" onClick={() => setSelected(new Set())}>선택 해제</button>
            <button className="btn-primary bulk-apply" onClick={applyBulk} disabled={busy}>선택한 상품에 색 적용</button>
            <button className="bulk-delete" onClick={() => run(async () => { const r = await deleteProducts([...selected]); setSelected(new Set()); return r; })} disabled={busy}>
              <Trash2 size={13} /> 삭제
            </button>
          </div>
          <ColorPicker fill={bulk.fill} border={bulk.border} onChange={(f, b) => setBulk({ fill: f, border: b })} sample="일괄 적용 미리보기" />
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="notice-text">{notice}</p>}

      <div className="product-list">
        {filtered.length > 0 && (
          <label className="select-all">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={() => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((p) => p.id)))}
            />
            현재 목록 전체 선택
          </label>
        )}
        {filtered.length === 0 && <p className="empty-text">{products.length === 0 ? '등록된 상품이 없습니다.' : '검색 결과가 없습니다.'}</p>}
        {filtered.map((p) => {
          const c = colorOf(p);
          const rc = resolveColors(c.fill, c.border);
          return (
            <div key={p.id} className="product-row">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="product-pill" style={{ backgroundColor: rc.fill, borderColor: rc.border, color: rc.text }}>{p.name}</span>
              <span className={`via-tag via-tag-${p.created_via}`}>{p.created_via === 'order' ? '주문입력' : '수기입력'}</span>
              <span className="via-date">{formatDate(p.created_at)} 등록</span>
              <button className="color-btn" onClick={() => setOpenId(openId === p.id ? null : p.id)}>색상</button>
              <button className="icon-btn icon-btn-delete" title="삭제" onClick={() => run(() => deleteProducts([p.id]))}>
                <Trash2 size={13} />
              </button>
              {openId === p.id && (
                <div className="color-panel">
                  <ColorPicker fill={c.fill} border={c.border} onChange={(f, b) => handleColor(p, f, b)} sample={p.name} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .products-root { display: flex; flex-direction: column; gap: 1rem; }
        .add-card, .bulk-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 1rem; }
        .add-row { display: flex; gap: 0.625rem; }
        .add-btn { display: flex; align-items: center; gap: 0.375rem; height: 2.5rem; padding: 0 1.1rem; white-space: nowrap; flex-shrink: 0; }
        .tool-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .search-box { display: flex; align-items: center; gap: 0.4rem; border: 1px solid var(--border); background: #fff; border-radius: 999px; padding: 0.4rem 0.9rem; color: var(--muted-foreground); }
        .search-box input { border: none; outline: none; font-size: 0.875rem; background: transparent; min-width: 12rem; }
        .count-text { font-size: 0.8125rem; color: var(--muted-foreground); }
        .auto-btn { margin-left: auto; display: flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; font-weight: 700; padding: 0.45rem 0.9rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--primary); cursor: pointer; }
        .auto-btn:disabled { opacity: 0.45; cursor: default; }
        .bulk-card { display: flex; flex-direction: column; gap: 0.75rem; }
        .bulk-head { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; font-size: 0.875rem; }
        .bulk-clear, .bulk-delete { font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; cursor: pointer; display: flex; align-items: center; gap: 0.3rem; }
        .bulk-delete { margin-left: auto; color: var(--danger); }
        .bulk-apply { padding: 0.4rem 1rem; }
        .error-text { color: var(--danger); font-size: 0.8125rem; font-weight: 500; }
        .notice-text { color: var(--success); font-size: 0.8125rem; font-weight: 600; }
        .empty-text { color: var(--muted-foreground); font-size: 0.875rem; padding: 1.5rem 0; text-align: center; }
        .product-list { display: flex; flex-direction: column; gap: 0.4rem; }
        .select-all { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--muted-foreground); padding: 0 0.25rem; }
        .product-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; padding: 0.55rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #fff; box-shadow: var(--shadow-sm); }
        .product-pill { border: 2px solid; border-radius: 8px; padding: 0.2rem 0.9rem; font-size: 0.875rem; font-weight: 700; min-width: 8rem; text-align: center; }
        .via-tag { font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid; white-space: nowrap; margin-left: auto; }
        .via-tag-order { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
        .via-tag-manual { background: #f1f5f9; border-color: #cbd5e1; color: #475569; }
        .via-date { font-size: 0.75rem; color: var(--muted-foreground); white-space: nowrap; }
        .color-btn { font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; cursor: pointer; flex-shrink: 0; }
        .color-panel { flex-basis: 100%; }
        .icon-btn { width: 28px; height: 28px; border-radius: 7px; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
        .icon-btn-delete { background: var(--danger-bg); color: var(--danger); }
      `}</style>
    </div>
  );
}
