'use client';
import '@/components/admin/admin.css';
import { useEffect, useState } from 'react';
import { KeyRound, Pencil, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MENU_DEFS, MENU_KEYS, permissionKeysOf, type MenuKey } from '@/lib/permissions/catalog';
import { createUser, deleteUser, savePermissions, updateUser } from './actions';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isMaster: boolean;
  lastSignInAt: string | null;
  permissions: string[];
}

const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '접속 기록 없음');
const menuCount = (keys: string[]) => MENU_KEYS.filter((m) => keys.includes(`${m}:view`)).length;

// 왼쪽: 사용자 목록과 등록·수정·삭제. 오른쪽: 고른 사용자의 메뉴·기능 권한(보고 바로 고친다).
// 사용자 등록·수정은 팝업에서 한다.
export function UsersClient({ users, meId, setupError }: { users: UserRow[]; meId: string; setupError: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; user: UserRow } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [permDirty, setPermDirty] = useState(false);

  // 아무도 고르지 않았거나 고른 사용자가 사라졌으면(삭제 등) 첫 사용자를 보여준다(master가 아니면 우선).
  const selected = users.find((u) => u.id === selectedId) ?? users.find((u) => !u.isMaster) ?? users[0] ?? null;

  const select = (id: string) => {
    if (id === selected?.id) return;
    if (permDirty && !window.confirm('저장하지 않은 권한 변경이 있습니다. 버리고 이동할까요?')) return;
    setPermDirty(false);
    setSelectedId(id);
  };

  return (
    <div className="us-root">
      <AdminHeader icon={<ShieldCheck size={20} />} title="사용자 및 권한" sub="사용자를 등록하고 메뉴·기능별 권한을 정합니다." />
      {setupError && <p className="ak-error">{setupError}</p>}
      {message && <p className="ak-notice">{message}</p>}

      <div className="us-layout">
        <section className="us-list-pane" aria-label="사용자 목록">
          <div className="us-pane-head">
            <h2>사용자 <span className="ak-muted">{users.length}명</span></h2>
            <button className="ak-btn ak-btn-primary" onClick={() => setModal({ mode: 'create' })} disabled={!!setupError}><UserPlus size={14} /> 사용자 등록</button>
          </div>
          <ul className="us-list">
            {users.map((u) => (
              <li key={u.id} className={u.id === selected?.id ? 'us-item-on' : ''}>
                <button className="us-item" onClick={() => select(u.id)}>
                  <span className="us-avatar">{(u.displayName || u.email)[0]?.toUpperCase()}</span>
                  <span className="us-item-text">
                    <strong>{u.displayName || u.email} {u.isMaster && <span className="us-master">최고 권한자</span>}</strong>
                    <span className="us-sub">{u.email}</span>
                    <span className="us-sub">{u.isMaster ? '모든 메뉴 사용' : `메뉴 ${menuCount(u.permissions)}개`} · 마지막 접속 {formatTime(u.lastSignInAt)}</span>
                  </span>
                </button>
                <span className="us-item-actions">
                  <button className="us-icon" title="수정" aria-label={`${u.displayName || u.email} 수정`} onClick={() => setModal({ mode: 'edit', user: u })}><Pencil size={14} /></button>
                  {!u.isMaster && u.id !== meId && <DeleteButton user={u} onDeleted={(name) => setMessage(`${name} 계정을 삭제했습니다.`)} />}
                </span>
              </li>
            ))}
            {users.length === 0 && <li className="us-empty">등록된 사용자가 없습니다.</li>}
          </ul>
        </section>

        <section className="us-detail-pane" aria-label="권한">
          {selected ? (
            <PermissionEditor key={selected.id} user={selected} onDirtyChange={setPermDirty} onSaved={() => setMessage(`${selected.displayName || selected.email}의 권한을 저장했습니다.`)} />
          ) : (
            <p className="us-empty">왼쪽에서 사용자를 선택하면 권한이 보입니다.</p>
          )}
        </section>
      </div>

      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.mode === 'edit' ? modal.user : null}
          onClose={() => setModal(null)}
          onDone={(text, createdId) => {
            setModal(null);
            setMessage(text);
            if (createdId) {
              setPermDirty(false);
              setSelectedId(createdId);
            }
          }}
        />
      )}

      <style>{`
        .us-root { display: flex; flex-direction: column; gap: 0.9rem; width: 100%; min-width: 0; }
        .us-layout { display: grid; grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr); gap: 1rem; align-items: start; }
        .us-list-pane, .us-detail-pane { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); min-width: 0; }
        .us-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); }
        .us-pane-head h2 { font-size: 0.9375rem; font-weight: 800; }
        .us-list { list-style: none; margin: 0; padding: 0.35rem; display: flex; flex-direction: column; gap: 0.15rem; }
        .us-list > li { display: flex; align-items: center; border-radius: 12px; border: 1px solid transparent; }
        .us-list > li:hover { background: #f8fafc; }
        .us-item-on, .us-list > li.us-item-on:hover { background: var(--primary-light, #eef4fb); border-color: var(--primary); }
        .us-item { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.6rem; background: none; border: 0; text-align: left; cursor: pointer; }
        .us-avatar { flex: none; width: 2.25rem; height: 2.25rem; border-radius: 999px; background: #e2e8f0; color: #334155; display: grid; place-items: center; font-weight: 800; }
        .us-item-on .us-avatar { background: var(--primary); color: #fff; }
        .us-item-text { display: flex; flex-direction: column; min-width: 0; gap: 0.1rem; }
        .us-item-text strong { font-size: 0.9375rem; font-weight: 800; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
        .us-master { font-size: 0.6875rem; font-weight: 800; color: #92400e; background: #fef3c7; border-radius: 999px; padding: 0.05rem 0.5rem; }
        .us-sub { font-size: 0.75rem; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .us-item-actions { display: flex; gap: 0.2rem; padding-right: 0.5rem; flex: none; }
        .us-icon { width: 2rem; height: 2rem; border-radius: 8px; border: 1px solid var(--border); background: #fff; display: grid; place-items: center; cursor: pointer; color: #475569; }
        .us-icon:hover { background: #f1f5f9; }
        .us-icon-danger { color: #dc2626; }
        .us-empty { padding: 2.5rem 1rem; text-align: center; color: var(--muted-foreground); font-size: 0.875rem; }
        .us-detail-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .us-detail-head h2 { font-size: 0.9375rem; font-weight: 800; }
        .us-matrix { display: flex; flex-direction: column; }
        .us-menu { display: grid; grid-template-columns: 9rem 1fr; gap: 0.5rem; padding: 0.7rem 1rem; border-bottom: 1px solid #f1f5f9; align-items: center; }
        .us-menu:last-child { border-bottom: 0; }
        .us-menu-name { font-weight: 800; font-size: 0.875rem; }
        .us-checks { display: flex; flex-wrap: wrap; gap: 0.45rem 1.1rem; }
        .us-checks label { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
        .us-checks input { width: 1rem; height: 1rem; }
        .us-note { padding: 0.8rem 1rem; font-size: 0.8125rem; color: var(--muted-foreground); }
        .us-modal-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(15, 23, 42, 0.45); display: grid; place-items: center; padding: 1rem; }
        .us-modal { width: min(26rem, 100%); background: #fff; border-radius: 16px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.3); display: flex; flex-direction: column; max-height: 100%; }
        .us-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); font-weight: 800; }
        .us-modal-body { padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.9rem; overflow-y: auto; }
        .us-modal-foot { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.9rem 1.25rem; border-top: 1px solid var(--border); }
        @media (max-width: 56rem) { .us-layout { grid-template-columns: 1fr; } .us-menu { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function DeleteButton({ user, onDeleted }: { user: UserRow; onDeleted: (name: string) => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const name = user.displayName || user.email;
    if (!window.confirm(`${name}(${user.email}) 계정을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    const result = await deleteUser(user.id);
    setBusy(false);
    if (result.error) return window.alert(result.error);
    onDeleted(name);
  };
  return (
    <button className="us-icon us-icon-danger" title="삭제" aria-label={`${user.displayName || user.email} 삭제`} onClick={remove} disabled={busy}>
      <Trash2 size={14} />
    </button>
  );
}

// 사용자 등록(이메일+비밀번호+이름) / 수정(이름, 새 비밀번호) 팝업
function UserModal({ mode, user, onClose, onDone }: { mode: 'create' | 'edit'; user: UserRow | null; onClose: () => void; onDone: (message: string, createdId: string | null) => void }) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === 'create') {
      const result = await createUser({ email, password, displayName });
      setBusy(false);
      if (result.error) return setError(result.error);
      onDone('사용자를 등록했습니다. 오른쪽에서 권한을 설정하세요.', result.userId);
    } else if (user) {
      const result = await updateUser(user.id, { displayName, password });
      setBusy(false);
      if (result.error) return setError(result.error);
      onDone('사용자 정보를 수정했습니다.', null);
    }
  };

  return (
    <div className="us-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="us-modal" role="dialog" aria-modal="true" aria-label={mode === 'create' ? '사용자 등록' : '사용자 수정'} onSubmit={submit}>
        <div className="us-modal-head">
          <span>{mode === 'create' ? '사용자 등록' : '사용자 수정'}</span>
          <button type="button" className="ak-panel-close" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>
        <div className="us-modal-body">
          <div className="ak-field">
            <label>이메일 (로그인 ID)</label>
            <input className="ak-input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} disabled={mode === 'edit'} required autoFocus={mode === 'create'} />
          </div>
          <div className="ak-field">
            <label>이름</label>
            <input className="ak-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required={mode === 'edit'} placeholder={mode === 'create' ? '비워 두면 이메일 앞부분' : ''} autoFocus={mode === 'edit'} />
          </div>
          <div className="ak-field">
            <label><KeyRound size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {mode === 'create' ? '비밀번호 (8자 이상)' : '새 비밀번호 (바꿀 때만, 8자 이상)'}</label>
            <input className="ak-input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required={mode === 'create'} />
          </div>
          {error && <p className="ak-error">{error}</p>}
          {mode === 'create' && <p className="ak-muted" style={{ fontSize: '0.8125rem' }}>새 사용자는 권한이 없는 상태로 시작합니다. 등록 후 오른쪽에서 열어 줄 메뉴를 고르세요.</p>}
        </div>
        <div className="us-modal-foot">
          <button type="button" className="ak-btn" onClick={onClose}>취소</button>
          <button type="submit" className="ak-btn ak-btn-primary" disabled={busy}>{busy ? '저장 중…' : mode === 'create' ? '등록' : '저장'}</button>
        </div>
      </form>
    </div>
  );
}

function PermissionEditor({ user, onDirtyChange, onSaved }: { user: UserRow; onDirtyChange: (dirty: boolean) => void; onSaved: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(user.permissions));
  const [saved, setSaved] = useState<string[]>(user.permissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = checked.size !== saved.length || saved.some((k) => !checked.has(k));
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const toggle = (menu: MenuKey, key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const view = `${menu}:view`;
      if (next.has(key)) {
        next.delete(key);
        // 보기를 끄면 그 메뉴의 나머지 권한도 같이 끈다.
        if (key === view) for (const k of permissionKeysOf(menu)) next.delete(k);
      } else {
        next.add(key);
        next.add(view); // 동작 권한을 켜면 메뉴를 열 수 있어야 한다.
      }
      return next;
    });
  const setAll = (on: boolean) => setChecked(new Set(on ? MENU_KEYS.flatMap(permissionKeysOf) : []));

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await savePermissions(user.id, [...checked]);
    setBusy(false);
    if (result.error) return setError(result.error);
    setSaved(result.saved);
    setChecked(new Set(result.saved));
    onSaved();
  };

  const name = user.displayName || user.email;
  if (user.isMaster) {
    return (
      <>
        <div className="us-detail-head"><h2>{name}의 권한</h2><span className="us-master">최고 권한자</span></div>
        <p className="us-note">모든 메뉴와 기능을 사용할 수 있고, 사용자 및 권한 메뉴는 이 계정만 열 수 있습니다. 최고 권한자의 권한은 바꿀 수 없습니다.</p>
        <div className="us-matrix">
          {MENU_KEYS.map((menu) => (
            <div key={menu} className="us-menu">
              <span className="us-menu-name">{MENU_DEFS[menu].label}</span>
              <span className="us-checks">
                {permissionKeysOf(menu).map((key) => (
                  <label key={key}><input type="checkbox" checked disabled readOnly /> {key.endsWith(':view') ? '메뉴 보기' : MENU_DEFS[menu].actions[key.split(':')[1] as keyof (typeof MENU_DEFS)[typeof menu]['actions']]}</label>
                ))}
              </span>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="us-detail-head">
        <h2>{name}의 권한</h2>
        <span className="ak-muted">{menuCountOf(checked)}개 메뉴</span>
        <span className="ak-spacer" />
        {error && <span className="ak-error">{error}</span>}
        <button className="ak-btn" onClick={() => setAll(true)}>전체 허용</button>
        <button className="ak-btn" onClick={() => setAll(false)}>전체 해제</button>
        <button className="ak-btn ak-btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? '저장 중…' : dirty ? '권한 저장' : '저장됨'}</button>
      </div>
      <div className="us-matrix">
        {MENU_KEYS.map((menu) => (
          <div key={menu} className="us-menu">
            <span className="us-menu-name">{MENU_DEFS[menu].label}</span>
            <span className="us-checks">
              <label><input type="checkbox" checked={checked.has(`${menu}:view`)} onChange={() => toggle(menu, `${menu}:view`)} /> 메뉴 보기</label>
              {Object.entries(MENU_DEFS[menu].actions).map(([action, label]) => (
                <label key={action}><input type="checkbox" checked={checked.has(`${menu}:${action}`)} onChange={() => toggle(menu, `${menu}:${action}`)} /> {label}</label>
              ))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

const menuCountOf = (checked: Set<string>) => MENU_KEYS.filter((m) => checked.has(`${m}:view`)).length;
