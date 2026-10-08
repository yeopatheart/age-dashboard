'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, Check, X, Building2, Search } from 'lucide-react';
import { createBusiness, updateBusiness, deleteBusiness } from './actions';
import { terminalColorSet } from '@/lib/terminal-color';

interface Terminal { id: string; name: string }
interface Business { id: string; name: string; terminal_id: string | null; notes: string | null; created_at: string; created_via: 'order' | 'manual' }

const formatDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '.');

export function BusinessesClient({ businesses, terminals }: { businesses: Business[]; terminals: Terminal[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const [newName, setNewName] = useState('');
  const [newTerminalId, setNewTerminalId] = useState(terminals[0]?.id ?? '');
  const [newNotes, setNewNotes] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingNotes, setEditingNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const terminalName = (id: string) => terminals.find((t) => t.id === id)?.name ?? '';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return businesses;
    return businesses.filter((b) => b.name.toLowerCase().includes(q));
  }, [businesses, search]);

  const handleAdd = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createBusiness(newName.trim(), newTerminalId || null, newNotes.trim() || null);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    setNewName('');
    setNewNotes('');
    router.refresh();
  };

  const handleTerminalChange = async (business: Business, terminalId: string) => {
    setError(null);
    const result = await updateBusiness(business.id, business.name, terminalId || null, business.notes);
    if (result.error) { setError(result.error); return; }
    router.refresh();
  };

  const startEdit = (b: Business) => {
    setEditingId(b.id);
    setEditingName(b.name);
    setEditingNotes(b.notes ?? '');
    setError(null);
  };

  const handleSaveEdit = async (business: Business) => {
    if (busy || !editingId || !editingName.trim()) return;
    setBusy(true);
    setError(null);
    const result = await updateBusiness(editingId, editingName.trim(), business.terminal_id, editingNotes.trim() || null);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    setEditingId(null);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setError(null);
    const result = await deleteBusiness(id);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    router.refresh();
  };

  return (
    <div className="businesses-root">
      <div className="page-header">
        <div className="page-header-icon"><Building2 size={20} /></div>
        <div>
          <h1 className="page-title">고객사 관리</h1>
          <p className="page-sub">업체별로 어느 터미널로 보낼지 미리 정해두면, 주문이 들어올 때마다 다시 고르지 않아도 됩니다.</p>
        </div>
      </div>

      <div className="add-card">
        <div className="add-row">
          <input
            className="input-field"
            placeholder="고객명 (예: 스시 하나)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <div className="terminal-field">
            <span className={`terminal-dot ${terminalColorSet(terminalName(newTerminalId)).dot}`} />
            <select className="input-field select-field terminal-select" value={newTerminalId} onChange={(e) => setNewTerminalId(e.target.value)}>
              <option value="">터미널 미지정</option>
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <input
            className="input-field notes-input"
            placeholder="메모 (선택)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <button className="btn-primary add-btn" onClick={handleAdd} disabled={busy || !newName.trim()}>
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="search-row">
        <Search size={15} className="search-icon" />
        <input
          className="search-input"
          placeholder="업체명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="search-count">{filtered.length}개 업체</span>
      </div>

      <div className="business-list">
        {filtered.length === 0 && <p className="empty-text">{businesses.length === 0 ? '등록된 업체가 없습니다.' : '검색 결과가 없습니다.'}</p>}
        {filtered.map((b) => (
          <div key={b.id} className="business-row">
            {editingId === b.id ? (
              <>
                <input
                  className="input-field business-name-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSaveEdit(b)}
                  autoFocus
                />
                <input
                  className="input-field notes-input"
                  placeholder="메모"
                  value={editingNotes}
                  onChange={(e) => setEditingNotes(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSaveEdit(b)}
                />
                <button className="icon-btn icon-btn-save" onClick={() => handleSaveEdit(b)} disabled={busy} title="저장">
                  <Check size={14} />
                </button>
                <button className="icon-btn icon-btn-cancel" onClick={() => setEditingId(null)} title="취소">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <div className="business-info">
                  <span className="business-name">{b.name}</span>
                  {b.notes && <span className="business-notes">{b.notes}</span>}
                </div>
                <span className={`via-tag via-tag-${b.created_via}`}>{b.created_via === 'order' ? '주문입력' : '수기입력'}</span>
                <span className="via-date">{formatDate(b.created_at)} 등록</span>
                <div className="terminal-field">
                  <span className={`terminal-dot ${terminalColorSet(terminalName(b.terminal_id ?? '')).dot}`} />
                  <select
                    className="input-field select-field terminal-select"
                    value={b.terminal_id ?? ''}
                    onChange={(e) => handleTerminalChange(b, e.target.value)}
                  >
                    <option value="">터미널 미지정</option>
                    {terminals.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <button className="icon-btn icon-btn-edit" onClick={() => startEdit(b)} title="수정">
                  <Pencil size={13} />
                </button>
                <button className="icon-btn icon-btn-delete" onClick={() => handleDelete(b.id)} title="삭제">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .businesses-root { display: flex; flex-direction: column; gap: 1.25rem; }
        .add-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          padding: 1rem;
        }
        .add-row { display: flex; gap: 0.625rem; flex-wrap: wrap; }
        .add-row .input-field { width: auto; flex: 1 1 160px; }
        .terminal-field { position: relative; flex: 0 0 150px; display: flex; align-items: center; }
        .terminal-dot { position: absolute; left: 0.75rem; width: 8px; height: 8px; border-radius: 50%; pointer-events: none; z-index: 1; }
        .terminal-select { flex: 1; padding-left: 1.75rem !important; cursor: pointer; }
        .notes-input { flex: 1 1 160px; }
        .add-btn { display: flex; align-items: center; gap: 0.375rem; height: 2.5rem; padding: 0 1.1rem; white-space: nowrap; flex-shrink: 0; }
        .error-text { color: var(--danger); font-size: 0.8125rem; font-weight: 500; }
        .search-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0 0.25rem;
        }
        .search-icon { color: var(--muted-foreground); flex-shrink: 0; }
        .search-input {
          flex: 1;
          border: none;
          background: transparent;
          font-size: 0.8125rem;
          outline: none;
          color: var(--foreground);
        }
        .search-count { font-size: 0.75rem; color: var(--muted-foreground); white-space: nowrap; }
        .empty-text { color: var(--muted-foreground); font-size: 0.875rem; padding: 1.5rem 0; text-align: center; }
        .business-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .business-row {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.75rem 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: #fff;
          box-shadow: var(--shadow-sm);
          transition: box-shadow 0.15s ease;
        }
        .business-row:hover { box-shadow: var(--shadow-md); }
        .business-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
        .via-tag { font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid; white-space: nowrap; flex-shrink: 0; }
        .via-tag-order { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
        .via-tag-manual { background: #f1f5f9; border-color: #cbd5e1; color: #475569; }
        .via-date { font-size: 0.75rem; color: var(--muted-foreground); white-space: nowrap; flex-shrink: 0; }
        .business-name { font-size: 0.9rem; font-weight: 600; color: var(--foreground); }
        .business-notes { font-size: 0.75rem; color: var(--muted-foreground); }
        .business-name-input { flex: 1; }
        .icon-btn {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: opacity 0.15s ease, transform 0.1s ease;
        }
        .icon-btn:hover { opacity: 0.85; }
        .icon-btn:active { transform: scale(0.94); }
        .icon-btn-edit { background: var(--muted); color: var(--foreground); }
        .icon-btn-delete { background: var(--danger-bg); color: var(--danger); }
        .icon-btn-save { background: var(--success-bg); color: var(--success); }
        .icon-btn-cancel { background: var(--muted); color: var(--muted-foreground); }
      `}</style>
    </div>
  );
}
