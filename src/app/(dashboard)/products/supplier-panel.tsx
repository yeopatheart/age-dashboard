'use client';
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { deleteSupplier, saveSupplier, type SupplierInput } from './actions';
import { SidePanel } from '@/components/admin/admin-kit';

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  memo: string | null;
}

const EMPTY: SupplierInput = { name: '', phone: '', memo: '' };

// 매입처 관리(등록·수정·삭제). 상품 관리 화면에서 오른쪽 패널로 연다. 저장하면 서버가 화면을 새로 보내 목록이 바뀐다.
export function SupplierPanel({
  suppliers,
  productCounts,
  canEdit,
  canDelete,
  onClose,
}: {
  suppliers: Supplier[];
  productCounts: Record<string, number>; // 매입처 id → 연결된 상품 수
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SupplierInput>(EMPTY);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = !!draft.id;
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
    return true;
  };

  const handleSave = async () => {
    if (await run(() => saveSupplier(draft))) setDraft(EMPTY);
  };

  return (
    <SidePanel title="매입처 관리" onClose={onClose}>
      {canEdit && (
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <strong style={{ fontSize: '0.8125rem' }}>{editing ? '매입처 수정' : '새 매입처'}</strong>
          <div className="ak-field">
            <label>이름 *</label>
            <input
              className="ak-input"
              value={draft.name}
              maxLength={60}
              placeholder="예: 통영 중앙수산"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && draft.name.trim() && handleSave()}
            />
          </div>
          <div className="ak-field">
            <label>연락처</label>
            <input className="ak-input" value={draft.phone} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
          </div>
          <div className="ak-field">
            <label>메모</label>
            <textarea className="ak-input ak-textarea" value={draft.memo} maxLength={500} onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="ak-btn ak-btn-primary" disabled={!draft.name.trim()} onClick={handleSave}>
              {editing ? <>저장</> : <><Plus size={14} /> 추가</>}
            </button>
            {editing && <button className="ak-btn" onClick={() => { setDraft(EMPTY); setError(null); }}>수정 취소</button>}
          </div>
        </fieldset>
      )}
      {error && <p className="ak-error" role="alert">{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
        <strong style={{ fontSize: '0.8125rem' }}>등록된 매입처 {suppliers.length}곳</strong>
        {suppliers.length === 0 && <p className="ak-muted">등록된 매입처가 없습니다.</p>}
        {suppliers.map((s) => (
          <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <strong style={{ flex: 1, minWidth: 0 }}>{s.name}</strong>
              <span className="ak-sub">상품 {productCounts[s.id] ?? 0}개</span>
              {canEdit && <button className="ak-btn" onClick={() => { setDraft({ id: s.id, name: s.name, phone: s.phone ?? '', memo: s.memo ?? '' }); setConfirmId(null); setError(null); }} title="수정"><Pencil size={13} /></button>}
              {canDelete && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmId(s.id)} title="삭제"><Trash2 size={13} /></button>}
            </div>
            {(s.phone || s.memo) && <span className="ak-sub">{[s.phone, s.memo].filter(Boolean).join(' · ')}</span>}
            {confirmId === s.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="ak-error" style={{ flex: 1 }}>삭제하면 상품과의 연결도 지워집니다.</span>
                <button className="ak-btn" onClick={() => setConfirmId(null)}>취소</button>
                <button
                  className="ak-btn ak-btn-primary"
                  style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => deleteSupplier(s.id))) setConfirmId(null);
                  }}
                >삭제</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </SidePanel>
  );
}
