'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, Check, X, Package } from 'lucide-react';
import { createBox, updateBox, deleteBox, setBoxActive, type BoxFields } from './actions';

interface Box {
  id: string;
  name: string;
  notes: string | null;
  inner_width_cm: number | null;
  inner_depth_cm: number | null;
  inner_height_cm: number | null;
  is_mulbong_box: boolean;
  is_active: boolean;
}

interface BoxForm {
  name: string;
  width: string;
  depth: string;
  height: string;
  isMulbongBox: boolean;
  isActive: boolean;
  notes: string;
}

const EMPTY_FORM: BoxForm = { name: '', width: '', depth: '', height: '', isMulbongBox: false, isActive: true, notes: '' };

function toFields(form: BoxForm): BoxFields {
  return {
    name: form.name.trim(),
    innerWidthCm: form.width.trim() ? parseFloat(form.width) : null,
    innerDepthCm: form.depth.trim() ? parseFloat(form.depth) : null,
    innerHeightCm: form.height.trim() ? parseFloat(form.height) : null,
    isMulbongBox: form.isMulbongBox,
    isActive: form.isActive,
    notes: form.notes.trim() || null,
  };
}

function formatDims(b: Box) {
  const { inner_width_cm, inner_depth_cm, inner_height_cm } = b;
  if (inner_width_cm == null && inner_depth_cm == null && inner_height_cm == null) return null;
  return `${inner_width_cm ?? '?'} × ${inner_depth_cm ?? '?'} × ${inner_height_cm ?? '?'} cm`;
}

export function BoxesClient({ boxes }: { boxes: Box[] }) {
  const router = useRouter();
  const [newForm, setNewForm] = useState<BoxForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BoxForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (busy || !newForm.name.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createBox(toFields(newForm));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNewForm(EMPTY_FORM);
    router.refresh();
  };

  const startEdit = (b: Box) => {
    setEditingId(b.id);
    setEditForm({
      name: b.name,
      width: b.inner_width_cm?.toString() ?? '',
      depth: b.inner_depth_cm?.toString() ?? '',
      height: b.inner_height_cm?.toString() ?? '',
      isMulbongBox: b.is_mulbong_box,
      isActive: b.is_active,
      notes: b.notes ?? '',
    });
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (busy || !editingId || !editForm.name.trim()) return;
    setBusy(true);
    setError(null);
    const result = await updateBox(editingId, toFields(editForm));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  };

  const handleToggleActive = async (b: Box) => {
    setError(null);
    const result = await setBoxActive(b.id, !b.is_active);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setError(null);
    const result = await deleteBox(id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="boxes-root">
      <div className="page-header">
        <div className="page-header-icon"><Package size={20} /></div>
        <div>
          <h1 className="page-title">박스 관리</h1>
          <p className="page-sub">가게에서 쓰는 박스 종류와 내측 치수를 등록합니다. 치수를 아직 모르면 이름만 먼저 등록하고 나중에 채워도 됩니다. 사용 중으로 표시된 박스만 포장 추천 후보가 됩니다.</p>
        </div>
      </div>

      <div className="add-card">
        <div className="add-row">
          <input
            className="input-field name-input"
            placeholder="박스 이름 (예: 5호)"
            value={newForm.name}
            onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <input
            className="input-field dim-input"
            type="number" min="0" step="any"
            placeholder="가로(cm)"
            value={newForm.width}
            onChange={(e) => setNewForm({ ...newForm, width: e.target.value })}
          />
          <input
            className="input-field dim-input"
            type="number" min="0" step="any"
            placeholder="세로(cm)"
            value={newForm.depth}
            onChange={(e) => setNewForm({ ...newForm, depth: e.target.value })}
          />
          <input
            className="input-field dim-input"
            type="number" min="0" step="any"
            placeholder="높이(cm)"
            value={newForm.height}
            onChange={(e) => setNewForm({ ...newForm, height: e.target.value })}
          />
          <label className="mulbong-check">
            <input
              type="checkbox"
              checked={newForm.isMulbongBox}
              onChange={(e) => setNewForm({ ...newForm, isMulbongBox: e.target.checked })}
            />
            물봉용
          </label>
          <label className="mulbong-check">
            <input
              type="checkbox"
              checked={newForm.isActive}
              onChange={(e) => setNewForm({ ...newForm, isActive: e.target.checked })}
            />
            사용중
          </label>
          <input
            className="input-field notes-input"
            placeholder="메모 (선택)"
            value={newForm.notes}
            onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <button className="btn-primary add-btn" onClick={handleAdd} disabled={busy || !newForm.name.trim()}>
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="box-list">
        {boxes.length === 0 && <p className="empty-text">등록된 박스가 없습니다.</p>}
        {boxes.map((b) => (
          <div key={b.id} className={`box-row ${b.is_active ? '' : 'box-row-inactive'}`}>
            {editingId === b.id ? (
              <>
                <input
                  className="input-field name-input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSaveEdit()}
                  autoFocus
                />
                <input
                  className="input-field dim-input"
                  type="number" min="0" step="any"
                  placeholder="가로"
                  value={editForm.width}
                  onChange={(e) => setEditForm({ ...editForm, width: e.target.value })}
                />
                <input
                  className="input-field dim-input"
                  type="number" min="0" step="any"
                  placeholder="세로"
                  value={editForm.depth}
                  onChange={(e) => setEditForm({ ...editForm, depth: e.target.value })}
                />
                <input
                  className="input-field dim-input"
                  type="number" min="0" step="any"
                  placeholder="높이"
                  value={editForm.height}
                  onChange={(e) => setEditForm({ ...editForm, height: e.target.value })}
                />
                <label className="mulbong-check">
                  <input
                    type="checkbox"
                    checked={editForm.isMulbongBox}
                    onChange={(e) => setEditForm({ ...editForm, isMulbongBox: e.target.checked })}
                  />
                  물봉용
                </label>
                <label className="mulbong-check">
                  <input
                    type="checkbox"
                    checked={editForm.isActive}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  />
                  사용중
                </label>
                <input
                  className="input-field notes-input"
                  placeholder="메모"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSaveEdit()}
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
                <div className="box-info">
                  <span className="box-name">{b.name}</span>
                  {b.is_mulbong_box && <span className="badge badge-info">물봉용</span>}
                  <button
                    type="button"
                    className={`badge active-toggle ${b.is_active ? 'badge-success' : 'badge-muted'}`}
                    onClick={() => handleToggleActive(b)}
                    title={b.is_active ? '클릭하면 사용 안 함으로 바꿉니다' : '클릭하면 사용 중으로 바꿉니다'}
                  >
                    {b.is_active ? '사용중' : '미사용'}
                  </button>
                  {formatDims(b) && <span className="box-dims">{formatDims(b)}</span>}
                  {b.notes && <span className="box-notes">{b.notes}</span>}
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
        .boxes-root { display: flex; flex-direction: column; gap: 1.25rem; }
        .add-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          padding: 1rem;
        }
        .add-row { display: flex; gap: 0.625rem; flex-wrap: wrap; align-items: center; }
        .name-input { width: auto; flex: 1 1 160px; }
        .dim-input { width: auto; flex: 0 1 90px; }
        .notes-input { width: auto; flex: 1 1 140px; }
        .mulbong-check {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          height: 2.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--foreground);
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
        }
        .mulbong-check input { width: 1.125rem; height: 1.125rem; accent-color: var(--primary); cursor: pointer; }
        .add-btn { display: flex; align-items: center; gap: 0.375rem; height: 2.5rem; padding: 0 1.1rem; white-space: nowrap; flex-shrink: 0; }
        .error-text { color: var(--danger); font-size: 0.8125rem; font-weight: 500; }
        .empty-text { color: var(--muted-foreground); font-size: 0.875rem; padding: 1.5rem 0; text-align: center; }
        .box-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .box-row {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.75rem 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: #fff;
          box-shadow: var(--shadow-sm);
          transition: box-shadow 0.15s ease;
          flex-wrap: wrap;
        }
        .box-row:hover { box-shadow: var(--shadow-md); }
        .box-row-inactive .box-name, .box-row-inactive .box-dims { color: var(--muted-foreground); }
        .active-toggle { border: none; cursor: pointer; font-family: inherit; }
        .active-toggle:hover { opacity: 0.8; }
        .box-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap; }
        .box-name { font-size: 0.9rem; font-weight: 600; color: var(--foreground); }
        .box-dims { font-size: 0.8125rem; color: var(--muted-foreground); font-weight: 500; }
        .box-notes { font-size: 0.75rem; color: var(--muted-foreground); }
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
