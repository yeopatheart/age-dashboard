'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, Check, X, MapPinned } from 'lucide-react';
import { createTerminal, updateTerminal, deleteTerminal } from './actions';

interface Terminal {
  id: string;
  name: string;
  created_at: string;
  created_via: 'order' | 'manual';
}

const formatDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '.');

export function TerminalsClient({ terminals }: { terminals: Terminal[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createTerminal(newName.trim());
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNewName('');
    router.refresh();
  };

  const startEdit = (t: Terminal) => {
    setEditingId(t.id);
    setEditingName(t.name);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (busy || !editingId || !editingName.trim()) return;
    setBusy(true);
    setError(null);
    const result = await updateTerminal(editingId, editingName.trim());
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setError(null);
    const result = await deleteTerminal(id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="terminals-root">
      <div className="page-header">
        <div className="page-header-icon"><MapPinned size={20} /></div>
        <div>
          <h1 className="page-title">터미널 관리</h1>
          <p className="page-sub">주문을 배송하는 터미널·배송수단 목록입니다. 고객사 관리 화면과 대시보드의 업체 등록 시 여기서 고른 터미널이 쓰입니다.</p>
        </div>
      </div>

      <div className="add-card">
        <div className="add-row">
          <input
            className="input-field"
            placeholder="예) 대구, 택배, 퀵"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <button className="btn-primary add-btn" onClick={handleAdd} disabled={busy || !newName.trim()}>
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="terminal-list">
        {terminals.length === 0 && <p className="empty-text">등록된 터미널이 없습니다.</p>}
        {terminals.map((t) => (
          <div key={t.id} className="terminal-row">
            {editingId === t.id ? (
              <>
                <input
                  className="input-field"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSaveEdit()}
                  autoFocus
                />
                <button className="icon-btn icon-btn-save" onClick={handleSaveEdit} disabled={busy} title="저장">
                  <Check size={14} />
                </button>
                <button className="icon-btn icon-btn-cancel" onClick={() => setEditingId(null)} title="취소">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span className="terminal-name">{t.name}</span>
                <span className={`via-tag via-tag-${t.created_via}`}>{t.created_via === 'order' ? '주문입력' : '수기입력'}</span>
                <span className="via-date">{formatDate(t.created_at)} 등록</span>
                <button className="icon-btn icon-btn-edit" onClick={() => startEdit(t)} title="수정">
                  <Pencil size={13} />
                </button>
                <button className="icon-btn icon-btn-delete" onClick={() => handleDelete(t.id)} title="삭제">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .terminals-root { display: flex; flex-direction: column; gap: 1.25rem; }
        .add-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          padding: 1rem;
        }
        .add-row { display: flex; gap: 0.625rem; }
        .add-btn { display: flex; align-items: center; gap: 0.375rem; height: 2.5rem; padding: 0 1.1rem; white-space: nowrap; flex-shrink: 0; }
        .error-text { color: var(--danger); font-size: 0.8125rem; font-weight: 500; }
        .empty-text { color: var(--muted-foreground); font-size: 0.875rem; padding: 1.5rem 0; text-align: center; }
        .terminal-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .terminal-row {
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
        .terminal-row:hover { box-shadow: var(--shadow-md); }
        .via-tag { font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid; white-space: nowrap; }
        .via-tag-order { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
        .via-tag-manual { background: #f1f5f9; border-color: #cbd5e1; color: #475569; }
        .via-date { font-size: 0.75rem; color: var(--muted-foreground); white-space: nowrap; }
        .terminal-name { flex: 1; font-size: 0.9rem; font-weight: 600; color: var(--foreground); }
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
