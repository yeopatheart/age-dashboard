'use client';
import '@/components/admin/admin.css';
import { useState } from 'react';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MENU_DEFS, MENU_KEYS, permissionKeysOf } from '@/lib/permissions/catalog';
import { createUser, deleteUser, savePermissions } from './actions';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isMaster: boolean;
  lastSignInAt: string | null;
  permissions: string[];
}

const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '접속 기록 없음');

export function UsersClient({ users, meId, setupError }: { users: UserRow[]; meId: string; setupError: string | null }) {
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const { error } = await createUser(form);
    setBusy(false);
    if (error) return setFormError(error);
    setForm({ email: '', password: '', displayName: '' });
    setMessage('사용자를 등록했습니다. 권한을 설정해야 메뉴가 보입니다.');
  };

  return (
    <div className="us-root">
      <AdminHeader icon={<ShieldCheck size={20} />} title="사용자 및 권한" sub="최고 권한자(master)만 열 수 있습니다. 사용자를 등록하고 메뉴·기능별 권한을 정합니다." />
      {setupError && <p className="ak-error">{setupError}</p>}
      {message && <p className="ak-notice">{message}</p>}

      <section className="us-card">
        <h2><UserPlus size={16} /> 사용자 등록</h2>
        <form className="us-form" onSubmit={handleCreate}>
          <div className="ak-field"><label>이메일</label><input className="ak-input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div className="ak-field"><label>비밀번호 (8자 이상)</label><input className="ak-input" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
          <div className="ak-field"><label>이름 (선택)</label><input className="ak-input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
          <button className="ak-btn ak-btn-primary" type="submit" disabled={busy || !!setupError}>{busy ? '등록 중…' : '등록'}</button>
        </form>
        {formError && <p className="ak-error">{formError}</p>}
        <p className="ak-muted">새 사용자는 권한이 없는 상태로 시작합니다. 등록한 뒤 아래에서 메뉴를 열어 주세요.</p>
      </section>

      <section className="us-card">
        <h2>사용자 ({users.length}명)</h2>
        <ul className="us-list">
          {users.map((u) => (
            <li key={u.id}>
              <div className="us-head">
                <div className="us-who">
                  <strong>{u.displayName || u.email}</strong>
                  {u.isMaster && <span className="ak-badge">최고 권한자</span>}
                  <span className="ak-muted">{u.email} · 마지막 접속 {formatTime(u.lastSignInAt)}</span>
                </div>
                {!u.isMaster && (
                  <div className="us-actions">
                    <button className="ak-btn" onClick={() => setOpenId(openId === u.id ? null : u.id)}>{openId === u.id ? '닫기' : '권한 설정'}</button>
                    {u.id !== meId && <DeleteButton user={u} />}
                  </div>
                )}
              </div>
              {u.isMaster && <p className="ak-muted">모든 메뉴와 기능을 사용할 수 있고, 이 메뉴는 이 계정만 열 수 있습니다.</p>}
              {openId === u.id && !u.isMaster && <PermissionEditor user={u} onSaved={() => setMessage(`${u.displayName || u.email}의 권한을 저장했습니다.`)} />}
              {!u.isMaster && openId !== u.id && <p className="ak-muted">{summary(u.permissions)}</p>}
            </li>
          ))}
        </ul>
      </section>

      <style>{`
        .us-root { display: flex; flex-direction: column; gap: 1rem; max-width: 52rem; width: 100%; min-width: 0; }
        .us-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.8rem; box-shadow: var(--shadow-sm); }
        .us-card h2 { font-size: 0.9375rem; font-weight: 800; display: flex; align-items: center; gap: 0.4rem; }
        .us-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)) auto; gap: 0.7rem; align-items: end; }
        .us-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .us-list > li { padding: 0.8rem 0; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 0.5rem; }
        .us-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
        .us-who { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
        .us-actions { display: flex; gap: 0.4rem; }
        .us-matrix { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .us-menu { display: grid; grid-template-columns: 8rem 1fr; gap: 0.5rem; padding: 0.55rem 0.8rem; border-bottom: 1px solid #f1f5f9; align-items: center; }
        .us-menu:last-child { border-bottom: 0; }
        .us-menu-name { font-weight: 800; font-size: 0.875rem; }
        .us-checks { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; }
        .us-checks label { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
        .us-checks input { width: 1rem; height: 1rem; }
        .us-bar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
        @media (max-width: 40rem) { .us-menu { grid-template-columns: 1fr; } .us-form { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function summary(keys: string[]) {
  const menus = MENU_KEYS.filter((m) => keys.includes(`${m}:view`)).map((m) => MENU_DEFS[m].label);
  return menus.length ? `열 수 있는 메뉴: ${menus.join(', ')}` : '열 수 있는 메뉴가 없습니다. 권한을 설정하세요.';
}

function DeleteButton({ user }: { user: UserRow }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!window.confirm(`${user.displayName || user.email}(${user.email}) 계정을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    const result = await deleteUser(user.id);
    setBusy(false);
    if (result.error) return setError(result.error);
  };
  return (
    <>
      <button className="ak-btn ak-btn-danger" onClick={remove} disabled={busy}><Trash2 size={14} /> 삭제</button>
      {error && <span className="ak-error">{error}</span>}
    </>
  );
}

function PermissionEditor({ user, onSaved }: { user: UserRow; onSaved: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(user.permissions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (menu: (typeof MENU_KEYS)[number], key: string) =>
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
    onSaved();
  };

  return (
    <div className="us-editor">
      <div className="us-bar">
        <button className="ak-btn" onClick={() => setAll(true)}>전체 허용</button>
        <button className="ak-btn" onClick={() => setAll(false)}>전체 해제</button>
        <span className="ak-spacer" />
        {error && <span className="ak-error">{error}</span>}
        <button className="ak-btn ak-btn-primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '권한 저장'}</button>
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
    </div>
  );
}
