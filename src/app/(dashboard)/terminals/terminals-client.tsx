'use client';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPinned, Plus, Trash2 } from 'lucide-react';
import { createTerminal, updateTerminal, deleteTerminal, setTerminalColor, setTerminalSeparate } from './actions';
import { ColorPicker } from '@/components/color-picker';
import { terminalBadgeProps } from '@/lib/terminal-color';
import {
  AdminHeader,
  ColumnMenu,
  DataTable,
  FilterSelect,
  SearchInput,
  SidePanel,
  Toggle,
  ViaTag,
  useHiddenColumns,
  type Column,
} from '@/components/admin/admin-kit';

interface Terminal {
  id: string;
  name: string;
  created_at: string;
  created_via: 'order' | 'manual';
  fill_color: string | null;
  border_color: string | null;
  is_separate: boolean;
}

export function TerminalsClient({ terminals, businessCount }: { terminals: Terminal[]; businessCount: Record<string, number> }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [viaFilter, setViaFilter] = useState('all');
  const [separateFilter, setSeparateFilter] = useState('all');
  const [newName, setNewName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useHiddenColumns('ak-cols-terminals');
  // 색·별도 주문은 누르는 즉시 저장하고 화면에도 바로 반영한다(서버 갱신을 기다리지 않는다).
  const [local, setLocal] = useState<Record<string, Partial<Terminal>>>({});

  const view = (t: Terminal): Terminal => ({ ...t, ...local[t.id] });
  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return terminals
      .map(view)
      .filter((t) => (k ? t.name.toLowerCase().includes(k) : true))
      .filter((t) => (viaFilter === 'all' ? true : t.created_via === viaFilter))
      .filter((t) => (separateFilter === 'all' ? true : separateFilter === 'separate' ? t.is_separate : !t.is_separate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals, local, search, viaFilter, separateFilter]);
  const open = openId ? terminals.map(view).find((t) => t.id === openId) ?? null : null;

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

  const addInputRef = useRef<HTMLInputElement>(null);
  const handleAdd = async () => {
    // 비어 있으면 버튼을 비활성(회색)으로 두지 않고 입력창으로 안내한다 — 다른 관리 화면의 추가 버튼과 같은 모양을 유지한다.
    if (!newName.trim()) {
      addInputRef.current?.focus();
      return;
    }
    if (await run(() => createTerminal(newName.trim()))) setNewName('');
  };
  const setSeparate = async (t: Terminal, value: boolean) => {
    setLocal((p) => ({ ...p, [t.id]: { ...p[t.id], is_separate: value } }));
    await setTerminalSeparate(t.id, value);
    router.refresh();
  };
  const setColor = async (t: Terminal, fill: string | null, border: string | null) => {
    setLocal((p) => ({ ...p, [t.id]: { ...p[t.id], fill_color: fill, border_color: border } }));
    await setTerminalColor(t.id, fill, border);
    router.refresh();
  };
  const openPanel = (t: Terminal) => {
    setOpenId(t.id);
    setNameDraft(t.name);
    setConfirmDelete(false);
    setError(null);
  };

  const columns: Column<Terminal>[] = [
    {
      key: 'name',
      label: '터미널',
      hideable: false,
      render: (t) => {
        const b = terminalBadgeProps(t.name, { [t.name]: { fill: t.fill_color, border: t.border_color } });
        return <span className={`ak-badge ${b.className}`} style={b.style}>{t.name}</span>;
      },
    },
    { key: 'businesses', label: '업체 수', render: (t) => <span className="ak-muted">{businessCount[t.id] ?? 0}곳</span> },
    {
      key: 'separate',
      label: '별도 주문',
      render: (t) => <Toggle checked={t.is_separate} onChange={(v) => setSeparate(t, v)} label={`${t.name} 별도 주문`} />,
    },
    { key: 'via', label: '등록', render: (t) => <ViaTag via={t.created_via} date={t.created_at} /> },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<MapPinned size={20} />} title="터미널 관리" sub="주문을 배송하는 터미널·배송수단입니다. 행을 누르면 색상과 이름을 바꿀 수 있습니다." />

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="터미널 검색" />
        <FilterSelect
          value={viaFilter}
          onChange={setViaFilter}
          options={[{ value: 'all', label: '등록: 전체' }, { value: 'order', label: '주문입력' }, { value: 'manual', label: '수기입력' }]}
        />
        <FilterSelect
          value={separateFilter}
          onChange={setSeparateFilter}
          options={[{ value: 'all', label: '주문표: 전체' }, { value: 'separate', label: '별도 주문' }, { value: 'main', label: '기본 주문표' }]}
        />
        <span className="ak-count">{filtered.length}개</span>
        <span className="ak-spacer" />
        <div className="ak-quick-add">
          <input
            ref={addInputRef}
            placeholder="새 터미널 (예: 대구, 택배)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          />
          <button className="ak-btn ak-btn-primary" onClick={handleAdd} disabled={busy}>
            <Plus size={14} /> 추가
          </button>
        </div>
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
      </div>

      {error && !open && <p className="ak-error">{error}</p>}

      <DataTable
        columns={columns}
        hidden={hidden}
        rows={filtered}
        rowKey={(t) => t.id}
        onRowClick={openPanel}
        activeKey={openId}
        emptyText={terminals.length === 0 ? '등록된 터미널이 없습니다.' : '조건에 맞는 터미널이 없습니다.'}
      />

      {open && (
        <SidePanel
          title="터미널 상세"
          onClose={() => setOpenId(null)}
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
                    if (await run(() => deleteTerminal(open.id))) setOpenId(null);
                    else setConfirmDelete(false);
                  }}
                >삭제</button>
              </>
            ) : (
              <>
                <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setOpenId(null)}>닫기</button>
                <button
                  className="ak-btn ak-btn-primary"
                  disabled={busy || !nameDraft.trim() || nameDraft.trim() === open.name}
                  onClick={() => run(() => updateTerminal(open.id, nameDraft.trim()))}
                >이름 저장</button>
              </>
            )
          }
        >
          <div className="ak-field">
            <label>터미널 이름</label>
            <input className="ak-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
          </div>
          <div className="ak-setting">
            <span>
              별도 주문
              <small>켜면 대시보드 기본 주문표에서 빼고 &apos;별도 주문&apos; 팝업에서 봅니다 (택배, 직배송 등)</small>
            </span>
            <Toggle checked={open.is_separate} onChange={(v) => setSeparate(open, v)} label="별도 주문" />
          </div>
          <div className="ak-field">
            <span className="ak-field-label">색상</span>
            <ColorPicker fill={open.fill_color} border={open.border_color} onChange={(f, b) => setColor(open, f, b)} sample={open.name} />
          </div>
          <p className="ak-meta">연결된 업체 {businessCount[open.id] ?? 0}곳 · {open.created_via === 'order' ? '주문입력' : '수기입력'}으로 {open.created_at.slice(0, 10).replace(/-/g, '.')} 등록</p>
          {error && <p className="ak-error">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
