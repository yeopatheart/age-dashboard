'use client';
import './admin.css';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ak-toggle"
      onClick={(e) => {
        e.stopPropagation(); // 행 클릭(상세 패널 열기)과 겹치지 않게
        onChange(!checked);
      }}
    />
  );
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
  if (items.length === 0) return null;
  return (
    <div className="ak-menu-wrap">
      <button className="ak-btn" onClick={() => setOpen((v) => !v)}>
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
}) {
  const visible = columns.filter((c) => c.hideable === false || !hidden.has(c.key));
  const selectable = !!selected && !!onToggleRow;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected!.has(rowKey(r)));
  return (
    <div className="ak-table-wrap">
      <table className="ak-table">
        <thead>
          <tr>
            {selectable && (
              <th className="ak-check">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} title="현재 목록 전체 선택" />
              </th>
            )}
            {visible.map((c) => (
              <th key={c.key} className={c.className}>{c.label}</th>
            ))}
            {onRowClick && <th className="ak-fit" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            return (
              <tr key={key} className={`${onRowClick ? 'ak-row' : ''} ${activeKey === key ? 'ak-row-active' : ''}`} onClick={() => onRowClick?.(r)}>
                {selectable && (
                  <td className="ak-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected!.has(key)} onChange={() => onToggleRow!(key)} />
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
export function SidePanel({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ak-overlay" onClick={onClose}>
      <aside className="ak-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ak-panel-head">
          <span>{title}</span>
          <button className="ak-panel-close" onClick={onClose} title="닫기"><X size={16} /></button>
        </div>
        <div className="ak-panel-body">{children}</div>
        {footer && <div className="ak-panel-foot">{footer}</div>}
      </aside>
    </div>
  );
}
