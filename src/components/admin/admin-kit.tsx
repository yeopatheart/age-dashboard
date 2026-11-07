'use client';
import './admin.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Columns3, Search, X } from 'lucide-react';

// 관리 화면 공통 부품. 새 정보가 늘어도 (1) 표에는 열 하나를 추가하고 "표시 항목" 메뉴로 숨길 수 있게 하며
// (2) 자세한 내용은 오른쪽 상세 패널에 필드로 추가하는 구조를 모든 관리 화면이 같게 쓴다.

export function AdminHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="page-header">
      <div className="page-header-icon">{icon}</div>
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{sub}</p>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = '검색' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="ak-search">
      <Search size={14} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  title?: string;
}) {
  return (
    <select className="ak-select" value={value} onChange={(e) => onChange(e.target.value)} title={title}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function ViaTag({ via, date }: { via: 'order' | 'manual'; date?: string }) {
  return (
    <span className="ak-via">
      <span className={`ak-tag ${via === 'order' ? 'ak-tag-order' : 'ak-tag-manual'}`}>{via === 'order' ? '주문입력' : '수기입력'}</span>
      {date && <span className="ak-sub">{date.slice(0, 10).replace(/-/g, '.')}</span>}
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ak-toggle"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation(); // 행 클릭(상세 패널 열기)과 겹치지 않게
        onChange(!checked);
      }}
    />
  );
}

// 저장 성공 같은 안내 문구. useState처럼 쓰되 몇 초 뒤 저절로 사라진다(다음 동작 때까지 남아 있으면 지난 안내를 새 결과로 착각한다).
export function useNotice(ms = 5000): [string | null, (value: string | null) => void] {
  const [notice, setNoticeState] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setNotice = useCallback(
    (value: string | null) => {
      clearTimeout(timer.current);
      setNoticeState(value);
      if (value) timer.current = setTimeout(() => setNoticeState(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [notice, setNotice];
}

// ─── 표시 항목(열) 선택 — 브라우저에 저장 ──────────────────────────────────────
const STORE_EVENT = 'ak-columns-changed';
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(STORE_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(STORE_EVENT, cb);
  };
}

export function useHiddenColumns(storageKey: string): [Set<string>, (next: Set<string>) => void] {
  // 서버 렌더에서는 저장값을 알 수 없어 빈 값(모두 표시)으로 그리고, 브라우저에서 저장값을 읽는다.
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(storageKey) ?? '';
      } catch {
        return '';
      }
    },
    () => '',
  );
  const hidden = useMemo(() => {
    try {
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);
  const save = (next: Set<string>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // 저장이 막힌 브라우저면 이번 화면에서만 적용되지 않는다.
    }
    window.dispatchEvent(new Event(STORE_EVENT));
  };
  return [hidden, save];
}

export function ColumnMenu({
  columns,
  hidden,
  onChange,
}: {
  columns: { key: string; label: string; hideable?: boolean }[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = columns.filter((c) => c.hideable !== false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="ak-menu-wrap">
      <button className="ak-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <Columns3 size={14} /> 표시 항목
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div className="ak-menu">
            {items.map((c) => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  checked={!hidden.has(c.key)}
                  onChange={() => {
                    const next = new Set(hidden);
                    if (next.has(c.key)) next.delete(c.key);
                    else next.add(c.key);
                    onChange(next);
                  }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 표 ────────────────────────────────────────────────────────────────────────
export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  hideable?: boolean; // false면 항상 표시(이름 열 등)
  className?: string;
}

export function DataTable<T>({
  columns,
  hidden,
  rows,
  rowKey,
  onRowClick,
  activeKey,
  selected,
  onToggleRow,
  onToggleAll,
  emptyText,
  limitRows,
}: {
  columns: Column<T>[];
  hidden: Set<string>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
  selected?: Set<string>;
  onToggleRow?: (key: string) => void;
  onToggleAll?: () => void;
  emptyText: string;
  limitRows?: boolean; // 최대 행 수(admin.css의 --ak-rows)를 넘으면 머리글을 고정한 채 표 안에서 세로 스크롤한다
}) {
  const visible = columns.filter((c) => c.hideable === false || !hidden.has(c.key));
  const selectable = !!selected && !!onToggleRow;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected!.has(rowKey(r)));
  return (
    <div className={`ak-table-wrap ${limitRows ? 'ak-limit' : ''}`}>
      <table className="ak-table">
        <thead>
          <tr>
            {selectable && (
              <th className="ak-check">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} title="현재 목록 전체 선택" aria-label="현재 목록 전체 선택" />
              </th>
            )}
            {visible.map((c) => (
              <th key={c.key} scope="col" className={c.className}>{c.label}</th>
            ))}
            {onRowClick && <th className="ak-fit" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            return (
              <tr
                key={key}
                className={`${onRowClick ? 'ak-row' : ''} ${activeKey === key ? 'ak-row-active' : ''}`}
                onClick={() => onRowClick?.(r)}
                // 키보드로도 행을 열 수 있게 한다(행 자체에 포커스가 있을 때만 — 행 안의 입력칸 타이핑을 가로채지 않는다).
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(r); } } : undefined}
              >
                {selectable && (
                  <td className="ak-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected!.has(key)} onChange={() => onToggleRow!(key)} aria-label="이 행 선택" />
                  </td>
                )}
                {visible.map((c) => (
                  <td key={c.key} className={c.className}>{c.render(r)}</td>
                ))}
                {onRowClick && (
                  <td className="ak-fit ak-chevron"><ChevronRight size={16} /></td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="ak-empty">{emptyText}</p>}
    </div>
  );
}

// ─── 오른쪽 상세 패널 ──────────────────────────────────────────────────────────
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// 오른쪽 상세 패널(모바일에서는 전체 화면). 대화상자로 동작한다: 열면 포커스가 패널로 들어오고, Tab은 패널 안에서만 돌며, 닫으면 열기 전 위치로 돌아간다.
// dirty가 true면 Esc·바깥 터치·닫기로 닫을 때 "저장하지 않은 변경" 확인을 받는다(입력한 값이 말없이 사라지지 않게).
// readOnly면 맨 위에 "수정 권한이 없어 보기만 가능" 안내를 띄운다(입력칸을 막는 것은 호출한 화면의 fieldset이 한다).
export function SidePanel({
  title,
  onClose,
  children,
  footer,
  width,
  dirty = false,
  readOnly = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string; // 기본 26rem보다 넓은 패널이 필요할 때(예: 영수증 미리보기)
  dirty?: boolean;
  readOnly?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 변경 내용을 버리고 닫을까요?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 열 때 포커스를 패널로 옮기고(입력칸에 이미 autoFocus가 있으면 그대로 둔다 — 폰에서 키보드가 저절로 뜨지 않게 패널 자체에 둔다), 닫을 때 원래 자리로 돌려준다.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  return (
    <div className="ak-overlay" onClick={requestClose}>
      <aside
        ref={panelRef}
        className="ak-panel"
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ak-panel-head">
          <span id={titleId}>{title}</span>
          <button className="ak-panel-close" onClick={requestClose} title="닫기" aria-label="닫기"><X size={16} /></button>
        </div>
        <div className="ak-panel-body">
          {readOnly && <div className="ak-readonly-note" role="note">수정 권한이 없어 내용을 보기만 할 수 있습니다.</div>}
          {children}
        </div>
        {footer && <div className="ak-panel-foot">{footer}</div>}
      </aside>
    </div>
  );
}

// 패널 안의 입력 묶음. canEdit이 false면 입력칸을 모두 잠근다(저장 버튼만 숨기면 입력은 되는데 저장이 안 되는 상태가 된다).
export function FieldGroup({ disabled, children }: { disabled: boolean; children: React.ReactNode }) {
  return (
    <fieldset className="ak-fieldset" disabled={disabled}>
      {children}
    </fieldset>
  );
}

// 삭제 확인 줄(패널 맨 아래). 모든 관리 화면이 같은 문구 형식을 쓴다: "'이름'을(를) 삭제할까요? {결과 설명} 되돌릴 수 없습니다."
export function DeleteFooter({
  name,
  consequence,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  consequence?: string; // 삭제하면 무엇이 어떻게 되는지(예: "이미 들어온 주문은 그대로 남습니다.")
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <span className="ak-error ak-delete-msg" role="alert">
        &apos;{name}&apos;을(를) 삭제할까요? {consequence ? `${consequence} ` : ''}되돌릴 수 없습니다.
      </span>
      <button className="ak-btn" onClick={onCancel} disabled={busy}>취소</button>
      <button className="ak-btn ak-btn-danger-solid" onClick={onConfirm} disabled={busy}>삭제</button>
    </>
  );
}
