'use client';
import { useMemo, useRef, useState } from 'react';
import { MapPinned, Plus, Trash2 } from 'lucide-react';
import { createTerminal, updateTerminal, deleteTerminal, setTerminalColor, setTerminalSeparate, setTerminalParcel, setTerminalQuickAllowed, setTerminalShippingRates } from './actions';
import { ColorPicker } from '@/components/color-picker';
import { formatWon, formatWonDraft, parseWon, wonInputError } from '@/lib/money';
import type { TerminalShipping } from '@/lib/settlement/shipping';
import { terminalBadgeProps } from '@/lib/terminal-color';
import { useCan } from '@/components/permissions-context';
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
  DeleteFooter,
} from '@/components/admin/admin-kit';

interface Terminal {
  id: string;
  name: string;
  created_at: string;
  created_via: 'order' | 'manual';
  fill_color: string | null;
  border_color: string | null;
  is_separate: boolean;
  is_parcel: boolean;
}

// shipping: 터미널 id → 퀵 가능 여부·수단별 박스당 기본 금액(정산 배송비 설정, 0062·0063). null이면 마이그레이션 전이라 그 설정 칸을 숨긴다.
export function TerminalsClient({ terminals, businessCount, shipping }: { terminals: Terminal[]; businessCount: Record<string, number>; shipping: Record<string, TerminalShipping> | null }) {
  const can = useCan();
  const canEdit = can('terminals:edit');
  const canDelete = can('terminals:delete');
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

  const [quickLocal, setQuickLocal] = useState<Record<string, boolean>>({});
  const quickOf = (t: Terminal) => quickLocal[t.id] ?? shipping?.[t.id]?.quickAllowed ?? true;
  // 수단별 박스당 금액(저장한 값). 저장하면 화면에 바로 반영한다.
  const [ratesLocal, setRatesLocal] = useState<Record<string, Pick<TerminalShipping, 'bus' | 'quick' | 'parcel'>>>({});
  const ratesOf = (t: Terminal) => ratesLocal[t.id] ?? { bus: shipping?.[t.id]?.bus ?? null, quick: shipping?.[t.id]?.quick ?? null, parcel: shipping?.[t.id]?.parcel ?? null };
  const [rateDraft, setRateDraft] = useState({ bus: '', quick: '', parcel: '' }); // 상세 패널에서 입력 중인 금액
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
    setLocal((p) => ({ ...p, [t.id]: { ...p[t.id], is_separate: value, ...(value ? {} : { is_parcel: false }) } }));
    await setTerminalSeparate(t.id, value);
  };
  const setParcel = async (t: Terminal, value: boolean) => {
    setLocal((p) => ({ ...p, [t.id]: { ...p[t.id], is_parcel: value, ...(value ? { is_separate: true } : {}) } }));
    await setTerminalParcel(t.id, value);
  };
  const setQuick = async (t: Terminal, value: boolean) => {
    const previous = quickOf(t);
    setQuickLocal((p) => ({ ...p, [t.id]: value }));
    const result = await setTerminalQuickAllowed(t.id, value).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    if (result.error) {
      setQuickLocal((p) => ({ ...p, [t.id]: previous }));
      setError(result.error);
    }
  };
  // 켜진 수단의 금액만 저장한다(꺼진 수단은 저장된 값을 그대로 둔다).
  const saveRates = async (t: Terminal) => {
    const parcel = t.is_parcel;
    const fields = parcel ? (['parcel'] as const) : quickOf(t) ? (['bus', 'quick'] as const) : (['bus'] as const);
    const problem = fields.map((k) => wonInputError(rateDraft[k])).find((p) => p !== null);
    if (problem) return setError(`배송비 금액을 확인해주세요. ${problem}`);
    const next = { ...ratesOf(t) };
    for (const k of fields) next[k] = parseWon(rateDraft[k]);
    if (await run(() => setTerminalShippingRates(t.id, next))) setRatesLocal((p) => ({ ...p, [t.id]: next }));
  };
  const setColor = async (t: Terminal, fill: string | null, border: string | null) => {
    setLocal((p) => ({ ...p, [t.id]: { ...p[t.id], fill_color: fill, border_color: border } }));
    await setTerminalColor(t.id, fill, border);
  };
  const openPanel = (t: Terminal) => {
    setOpenId(t.id);
    const rates = ratesOf(t);
    setRateDraft({ bus: formatWon(rates.bus), quick: formatWon(rates.quick), parcel: formatWon(rates.parcel) });
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
      render: (t) => <Toggle checked={t.is_separate} onChange={(v) => setSeparate(t, v)} label={`${t.name} 별도 주문`} disabled={!canEdit} />,
    },
    {
      key: 'parcel',
      label: '택배',
      render: (t) => <Toggle checked={t.is_parcel} onChange={(v) => setParcel(t, v)} label={`${t.name} 택배`} disabled={!canEdit} />,
    },
    ...(shipping
      ? [
          { key: 'quick', label: '퀵 가능', render: (t: Terminal) => <Toggle checked={quickOf(t)} onChange={(v) => setQuick(t, v)} label={`${t.name} 퀵 가능`} disabled={!canEdit} /> } satisfies Column<Terminal>,
          {
            key: 'rates',
            label: '배송비(박스당)',
            render: (t: Terminal) => {
              const r = ratesOf(t);
              const parts = t.is_parcel ? [['택배', r.parcel]] : [['버스', r.bus], ...(quickOf(t) ? [['퀵', r.quick]] : [])];
              const text = parts.filter(([, v]) => v !== null).map(([k, v]) => `${k} ${formatWon(v as number)}`).join(' · ');
              return text ? <span>{text}</span> : <span className="ak-muted">미설정</span>;
            },
          } satisfies Column<Terminal>,
        ]
      : []),
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
        {canEdit && <div className="ak-quick-add">
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
        </div>}
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
      </div>

      {error && !open && <p className="ak-error" role="alert">{error}</p>}

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
          dirty={canEdit && nameDraft !== open.name}
          readOnly={!canEdit}
          footer={
            confirmDelete ? (
              <DeleteFooter
                name={open.name}
                consequence="이 터미널을 쓰는 업체나 주문 이력이 있으면 삭제할 수 없습니다."
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  if (await run(() => deleteTerminal(open.id))) setOpenId(null);
                  else setConfirmDelete(false);
                }}
              />
            ) : (
              <>
                {canDelete && (
                  <button
                    className="ak-btn ak-btn-danger"
                    disabled={(businessCount[open.id] ?? 0) > 0}
                    title={(businessCount[open.id] ?? 0) > 0 ? `연결된 업체 ${businessCount[open.id]}곳이 있어 삭제할 수 없습니다` : undefined}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={14} /> 삭제
                  </button>
                )}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setOpenId(null)}>닫기</button>
                {canEdit && <button
                  className="ak-btn ak-btn-primary"
                  disabled={busy || !nameDraft.trim() || nameDraft.trim() === open.name}
                  onClick={() => run(() => updateTerminal(open.id, nameDraft.trim()))}
                >이름 저장</button>}
              </>
            )
          }
        >
          <div className="ak-field">
            <label>터미널 이름</label>
            <input className="ak-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="ak-setting">
            <span>
              별도 주문
              <small>켜면 대시보드 기본 주문표에서 빼고 &apos;별도 주문&apos; 팝업에서 봅니다 (택배, 직배송 등)</small>
            </span>
            <Toggle checked={open.is_separate} onChange={(v) => setSeparate(open, v)} label="별도 주문" disabled={!canEdit} />
          </div>
          <div className="ak-setting">
            <span>
              택배
              <small>택배사 송장을 붙이는 터미널입니다. 켜면 박스 라벨을 출력하지 않고, 박스는 1개로 봅니다(켜면 별도 주문도 함께 켜집니다)</small>
            </span>
            <Toggle checked={open.is_parcel} onChange={(v) => setParcel(open, v)} label="택배" disabled={!canEdit} />
          </div>
          {shipping && (
            <>
              <div className="ak-setting">
                <span>
                  퀵 가능
                  <small>끄면 이 터미널로 가는 고객에게는 정산 배송비로 퀵을 제안하지 않습니다(이미 저장한 값은 그대로 둡니다)</small>
                </span>
                <Toggle checked={quickOf(open)} onChange={(v) => setQuick(open, v)} label="퀵 가능" disabled={!canEdit || open.is_parcel} />
              </div>
              <div className="ak-field">
                <label>정산 배송비 (박스당, 원)</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {(open.is_parcel ? (['parcel'] as const) : quickOf(open) ? (['bus', 'quick'] as const) : (['bus'] as const)).map((k) => (
                    <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 6rem' }}>
                      <span className="ak-sub">{k === 'bus' ? '버스' : k === 'quick' ? '퀵' : '택배'}</span>
                      <input
                        className="ak-input"
                        inputMode="numeric"
                        style={{ textAlign: 'right' }}
                        placeholder="사용 안 함"
                        disabled={!canEdit}
                        aria-label={`${k === 'bus' ? '버스' : k === 'quick' ? '퀵' : '택배'} 박스당 금액`}
                        value={rateDraft[k]}
                        onChange={(e) => setRateDraft({ ...rateDraft, [k]: formatWonDraft(e.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <p className="ak-sub" style={{ margin: 0 }}>
                  {open.is_parcel ? '택배 터미널은 택배 금액만 씁니다. ' : '버스는 택배가 아닌 터미널, 퀵은 퀵 가능 터미널에서 고객사 관리의 "퀵 이용"을 체크한 고객에게 제안합니다. '}
                  비워 두면 제안하지 않습니다. 정산에서 이 금액 × 박스 수로 자동 산정하고, 날짜별로 고칠 수 있습니다.
                </p>
                {canEdit && <button className="ak-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => saveRates(open)}>배송비 금액 저장</button>}
              </div>
            </>
          )}
          <div className="ak-field">
            <span className="ak-field-label">색상</span>
            <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><ColorPicker fill={open.fill_color} border={open.border_color} onChange={(f, b) => setColor(open, f, b)} sample={open.name} /></fieldset>
          </div>
          <p className="ak-meta">연결된 업체 {businessCount[open.id] ?? 0}곳 · {open.created_via === 'order' ? '주문입력' : '수기입력'}으로 {open.created_at.slice(0, 10).replace(/-/g, '.')} 등록</p>
          {error && <p className="ak-error" role="alert">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
