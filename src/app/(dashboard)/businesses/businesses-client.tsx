'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { createBusiness, updateBusiness, deleteBusiness } from './actions';
import { terminalBadgeProps, type TerminalColorMap } from '@/lib/terminal-color';
import {
  AdminHeader,
  ColumnMenu,
  DataTable,
  FilterSelect,
  SearchInput,
  SidePanel,
  ViaTag,
  useHiddenColumns,
  type Column,
} from '@/components/admin/admin-kit';

interface Terminal { id: string; name: string; fill_color: string | null; border_color: string | null }
interface Business {
  id: string;
  name: string;
  terminal_id: string | null;
  notes: string | null;
  created_at: string;
  created_via: 'order' | 'manual';
}

type Draft = { name: string; terminalId: string; notes: string };
const EMPTY_DRAFT: Draft = { name: '', terminalId: '', notes: '' };

export function BusinessesClient({ businesses, terminals }: { businesses: Business[]; terminals: Terminal[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('all');
  const [viaFilter, setViaFilter] = useState('all');
  const [sort, setSort] = useState('name');
  // panel: null=닫힘, 'new'=새 고객사, 그 외=수정할 업체 id
  const [panel, setPanel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useHiddenColumns('ak-cols-businesses');

  const terminalColors: TerminalColorMap = Object.fromEntries(terminals.map((t) => [t.name, { fill: t.fill_color, border: t.border_color }]));
  const terminalById = new Map(terminals.map((t) => [t.id, t]));

  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    const list = businesses
      .filter((b) => (k ? b.name.toLowerCase().includes(k) || (b.notes ?? '').toLowerCase().includes(k) : true))
      .filter((b) => (terminalFilter === 'all' ? true : terminalFilter === 'none' ? !b.terminal_id : b.terminal_id === terminalFilter))
      .filter((b) => (viaFilter === 'all' ? true : b.created_via === viaFilter));
    return [...list].sort((a, b) => (sort === 'recent' ? b.created_at.localeCompare(a.created_at) : a.name.localeCompare(b.name, 'ko')));
  }, [businesses, search, terminalFilter, viaFilter, sort]);

  const editing = panel && panel !== 'new' ? businesses.find((b) => b.id === panel) ?? null : null;

  const openNew = () => {
    setPanel('new');
    setDraft({ ...EMPTY_DRAFT, terminalId: terminals[0]?.id ?? '' });
    setConfirmDelete(false);
    setError(null);
  };
  const openEdit = (b: Business) => {
    setPanel(b.id);
    setDraft({ name: b.name, terminalId: b.terminal_id ?? '', notes: b.notes ?? '' });
    setConfirmDelete(false);
    setError(null);
  };

  const run = async (fn: () => Promise<{ error: string | null }>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  };

  const handleSave = async () => {
    if (!draft.name.trim()) return;
    const terminalId = draft.terminalId || null;
    const notes = draft.notes.trim() || null;
    const ok = await run(() =>
      panel === 'new' ? createBusiness(draft.name, terminalId, notes) : updateBusiness(panel as string, draft.name, terminalId, notes),
    );
    if (ok) setPanel(null);
  };

  const columns: Column<Business>[] = [
    { key: 'name', label: '고객사', hideable: false, render: (b) => <span className="ak-name">{b.name}</span> },
    {
      key: 'terminal',
      label: '터미널',
      render: (b) => {
        const t = b.terminal_id ? terminalById.get(b.terminal_id) : undefined;
        if (!t) return <span className="ak-muted">미지정</span>;
        const p = terminalBadgeProps(t.name, terminalColors);
        return <span className={`ak-badge ${p.className}`} style={p.style}>{t.name}</span>;
      },
    },
    { key: 'notes', label: '메모', render: (b) => (b.notes ? <span className="ak-ellipsis ak-muted">{b.notes}</span> : <span className="ak-muted">—</span>) },
    { key: 'via', label: '등록', render: (b) => <ViaTag via={b.created_via} date={b.created_at} /> },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<Building2 size={20} />} title="고객사 관리" sub="업체별로 보낼 터미널을 정해두면 주문이 들어올 때마다 다시 고르지 않아도 됩니다. 행을 누르면 수정할 수 있습니다." />

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="고객사·메모 검색" />
        <FilterSelect
          value={terminalFilter}
          onChange={setTerminalFilter}
          options={[
            { value: 'all', label: '터미널: 전체' },
            ...terminals.map((t) => ({ value: t.id, label: t.name })),
            { value: 'none', label: '미지정' },
          ]}
        />
        <FilterSelect
          value={viaFilter}
          onChange={setViaFilter}
          options={[{ value: 'all', label: '등록: 전체' }, { value: 'order', label: '주문입력' }, { value: 'manual', label: '수기입력' }]}
        />
        <FilterSelect value={sort} onChange={setSort} options={[{ value: 'name', label: '이름순' }, { value: 'recent', label: '최근 등록순' }]} />
        <span className="ak-count">{filtered.length}곳{filtered.length !== businesses.length ? ` / 전체 ${businesses.length}곳` : ''}</span>
        <span className="ak-spacer" />
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
        <button className="ak-btn ak-btn-primary" onClick={openNew}><Plus size={14} /> 고객사 추가</button>
      </div>

      <DataTable
        columns={columns}
        hidden={hidden}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={openEdit}
        activeKey={editing?.id ?? null}
        emptyText={businesses.length === 0 ? '등록된 고객사가 없습니다.' : '조건에 맞는 고객사가 없습니다.'}
      />

      {panel && (
        <SidePanel
          title={panel === 'new' ? '고객사 추가' : '고객사 상세'}
          onClose={() => setPanel(null)}
          footer={
            confirmDelete ? (
              <>
                <span className="ak-error" style={{ flex: 1 }}>정말 삭제할까요?</span>
                <button className="ak-btn" onClick={() => setConfirmDelete(false)}>취소</button>
                <button
                  className="ak-btn ak-btn-primary"
                  style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => deleteBusiness(panel))) setPanel(null);
                    else setConfirmDelete(false);
                  }}
                >삭제</button>
              </>
            ) : (
              <>
                {panel !== 'new' && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setPanel(null)}>취소</button>
                <button className="ak-btn ak-btn-primary" disabled={busy || !draft.name.trim()} onClick={handleSave}>저장</button>
              </>
            )
          }
        >
          <div className="ak-field">
            <label>고객사 이름 *</label>
            <input className="ak-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus placeholder="예) 스시 하나" />
          </div>
          <div className="ak-field">
            <label>터미널</label>
            <select className="ak-input" value={draft.terminalId} onChange={(e) => setDraft({ ...draft, terminalId: e.target.value })}>
              <option value="">미지정</option>
              {terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="ak-field">
            <label>메모</label>
            <textarea className="ak-input ak-textarea" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="배송 시 주의사항 등" />
          </div>
          {editing && (
            <p className="ak-meta">{editing.created_via === 'order' ? '주문입력' : '수기입력'}으로 {editing.created_at.slice(0, 10).replace(/-/g, '.')} 등록</p>
          )}
          {error && <p className="ak-error">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
