'use client';
import { useMemo, useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { createBusiness, updateBusiness, deleteBusiness, setBusinessShippingRates } from './actions';
import { formatWon, formatWonDraft, parseWon, wonInputError } from '@/lib/money';
import { SHIPPING_METHODS, type ShippingMethod, type ShippingRates } from '@/lib/settlement/shipping';
import { terminalBadgeProps, type TerminalColorMap } from '@/lib/terminal-color';
import { useCan } from '@/components/permissions-context';
import {
  AdminHeader,
  ColumnMenu,
  DataTable,
  FilterSelect,
  SearchInput,
  SidePanel,
  ViaTag,
  useHiddenColumns,
  type Column,
  DeleteFooter,
  FieldGroup,
} from '@/components/admin/admin-kit';

interface Terminal { id: string; name: string; fill_color: string | null; border_color: string | null }
interface Business {
  id: string;
  name: string;
  terminal_id: string | null;
  notes: string | null;
  created_at: string;
  created_via: 'order' | 'manual';
  business_registration_no: string | null;
  representative_name: string | null;
}

// bus·quick·parcel: 수단별 박스당 기본 금액(비우면 그 수단을 쓰지 않는 고객사)
type Draft = { name: string; terminalId: string; notes: string; regNo: string; rep: string; bus: string; quick: string; parcel: string };
const EMPTY_DRAFT: Draft = { name: '', terminalId: '', notes: '', regNo: '', rep: '', bus: '', quick: '', parcel: '' };
const ratesToDraft = (r: ShippingRates | undefined): Pick<Draft, ShippingMethod> => ({ bus: formatWon(r?.bus ?? null), quick: formatWon(r?.quick ?? null), parcel: formatWon(r?.parcel ?? null) });

// 입력하는 동안 숫자만 남기고 000-00-00000 모양으로 하이픈을 넣어 준다(최대 10자리).
const formatRegNo = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 10);
  return d.length <= 3 ? d : d.length <= 5 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

// shippingRates: 고객사 id → 정산 배송비 기본 금액, quickAllowed: 터미널 id → 퀵 가능 여부(0062). null이면 마이그레이션 전이라 그 설정 칸을 숨긴다.
export function BusinessesClient({ businesses, terminals, shippingRates, quickAllowed }: { businesses: Business[]; terminals: Terminal[]; shippingRates: Record<string, ShippingRates> | null; quickAllowed: Record<string, boolean> | null }) {
  const can = useCan();
  const canEdit = can('businesses:edit');
  const canDelete = can('businesses:delete');
  const [search, setSearch] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('all');
  const [viaFilter, setViaFilter] = useState('all');
  const [sort, setSort] = useState('name');
  // panel: null=닫힘, 'new'=새 고객사, 그 외=수정할 업체 id
  const [panel, setPanel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useHiddenColumns('ak-cols-businesses');

  const terminalColors: TerminalColorMap = Object.fromEntries(terminals.map((t) => [t.name, { fill: t.fill_color, border: t.border_color }]));
  const terminalById = new Map(terminals.map((t) => [t.id, t]));

  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    const list = businesses
      .filter((b) =>
        k
          ? b.name.toLowerCase().includes(k) ||
            (b.notes ?? '').toLowerCase().includes(k) ||
            (b.representative_name ?? '').toLowerCase().includes(k) ||
            (b.business_registration_no ?? '').replace(/-/g, '').includes(k.replace(/-/g, ''))
          : true,
      )
      .filter((b) => (terminalFilter === 'all' ? true : terminalFilter === 'none' ? !b.terminal_id : b.terminal_id === terminalFilter))
      .filter((b) => (viaFilter === 'all' ? true : b.created_via === viaFilter));
    return [...list].sort((a, b) => (sort === 'recent' ? b.created_at.localeCompare(a.created_at) : a.name.localeCompare(b.name, 'ko')));
  }, [businesses, search, terminalFilter, viaFilter, sort]);

  const editing = panel && panel !== 'new' ? businesses.find((b) => b.id === panel) ?? null : null;
  // 저장하지 않은 입력이 있는지(패널을 닫을 때 확인을 받는다)
  const baseline: Draft = panel === 'new' ? { ...EMPTY_DRAFT, terminalId: terminals[0]?.id ?? '' } : editing ? { name: editing.name, terminalId: editing.terminal_id ?? '', notes: editing.notes ?? '', regNo: editing.business_registration_no ?? '', rep: editing.representative_name ?? '', ...ratesToDraft(shippingRates?.[editing.id]) } : EMPTY_DRAFT;
  const dirty = !!panel && canEdit && JSON.stringify(draft) !== JSON.stringify(baseline);

  const openNew = () => {
    setPanel('new');
    setDraft({ ...EMPTY_DRAFT, terminalId: terminals[0]?.id ?? '' });
    setConfirmDelete(false);
    setError(null);
  };
  const openEdit = (b: Business) => {
    setPanel(b.id);
    setDraft({ name: b.name, terminalId: b.terminal_id ?? '', notes: b.notes ?? '', regNo: b.business_registration_no ?? '', rep: b.representative_name ?? '', ...ratesToDraft(shippingRates?.[b.id]) });
    setConfirmDelete(false);
    setError(null);
  };

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
    if (!draft.name.trim()) return;
    const terminalId = draft.terminalId || null;
    const notes = draft.notes.trim() || null;
    const info = { businessRegistrationNo: draft.regNo, representativeName: draft.rep };
    // 배송비 기본 금액은 이미 있는 고객사에서만 저장한다(새 고객사는 저장한 뒤 다시 열어 정한다).
    if (panel !== 'new' && shippingRates) {
      const problem = (['bus', 'quick', 'parcel'] as const).map((k) => wonInputError(draft[k])).find((p) => p !== null);
      if (problem) return setError(`배송비 기본 금액을 확인해주세요. ${problem}`);
    }
    const ok = await run(async () => {
      if (panel === 'new') return createBusiness(draft.name, terminalId, notes, info);
      const saved = await updateBusiness(panel as string, draft.name, terminalId, notes, info);
      if (saved.error || !shippingRates) return saved;
      return setBusinessShippingRates(panel as string, { bus: parseWon(draft.bus), quick: parseWon(draft.quick), parcel: parseWon(draft.parcel) });
    });
    if (ok) setPanel(null);
  };

  const columns: Column<Business>[] = [
    { key: 'name', label: '고객사', hideable: false, render: (b) => <span className="ak-name">{b.name}</span> },
    {
      key: 'terminal',
      label: '터미널',
      render: (b) => {
        const t = b.terminal_id ? terminalById.get(b.terminal_id) : undefined;
        if (!t) return <span className="ak-muted">미지정</span>;
        const p = terminalBadgeProps(t.name, terminalColors);
        return <span className={`ak-badge ${p.className}`} style={p.style}>{t.name}</span>;
      },
    },
    { key: 'rep', label: '대표자', render: (b) => (b.representative_name ? <span>{b.representative_name}</span> : <span className="ak-muted">—</span>) },
    { key: 'regNo', label: '사업자등록번호', render: (b) => (b.business_registration_no ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{b.business_registration_no}</span> : <span className="ak-muted">—</span>) },
    { key: 'notes', label: '메모', render: (b) => (b.notes ? <span className="ak-ellipsis ak-muted">{b.notes}</span> : <span className="ak-muted">—</span>) },
    { key: 'via', label: '등록', render: (b) => <ViaTag via={b.created_via} date={b.created_at} /> },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<Building2 size={20} />} title="고객사 관리" sub="업체별로 보낼 터미널을 정해두면 주문이 들어올 때마다 다시 고르지 않아도 됩니다. 행을 누르면 수정할 수 있습니다." />

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="고객사·대표자·사업자번호·메모 검색" />
        <FilterSelect
          value={terminalFilter}
          onChange={setTerminalFilter}
          options={[
            { value: 'all', label: '터미널: 전체' },
            ...terminals.map((t) => ({ value: t.id, label: t.name })),
            { value: 'none', label: '미지정' },
          ]}
        />
        <FilterSelect
          value={viaFilter}
          onChange={setViaFilter}
          options={[{ value: 'all', label: '등록: 전체' }, { value: 'order', label: '주문입력' }, { value: 'manual', label: '수기입력' }]}
        />
        <FilterSelect value={sort} onChange={setSort} options={[{ value: 'name', label: '이름순' }, { value: 'recent', label: '최근 등록순' }]} />
        <span className="ak-count">{filtered.length}곳{filtered.length !== businesses.length ? ` / 전체 ${businesses.length}곳` : ''}</span>
        <span className="ak-spacer" />
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
        {canEdit && <button className="ak-btn ak-btn-primary" onClick={openNew}><Plus size={14} /> 고객사 추가</button>}
      </div>

      <DataTable
        columns={columns}
        hidden={hidden}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={openEdit}
        activeKey={editing?.id ?? null}
        emptyText={businesses.length === 0 ? '등록된 고객사가 없습니다.' : '조건에 맞는 고객사가 없습니다.'}
      />

      {panel && (
        <SidePanel
          title={panel === 'new' ? '고객사 추가' : '고객사 상세'}
          onClose={() => setPanel(null)}
          dirty={dirty}
          readOnly={!canEdit}
          footer={
            confirmDelete ? (
              <DeleteFooter
                name={editing?.name ?? ''}
                consequence="과거 주문 기록이 있는 고객사는 삭제할 수 없습니다."
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  if (await run(() => deleteBusiness(panel))) setPanel(null);
                  else setConfirmDelete(false);
                }}
              />
            ) : (
              <>
                {canDelete && panel !== 'new' && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setPanel(null)}>닫기</button>
                {canEdit && <button className="ak-btn ak-btn-primary" disabled={busy || !draft.name.trim()} onClick={handleSave}>저장</button>}
              </>
            )
          }
        >
          <FieldGroup disabled={!canEdit}>
          <div className="ak-field">
            <label>고객사 이름 *</label>
            <input className="ak-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus placeholder="예) 스시 하나" />
          </div>
          <div className="ak-field">
            <label>터미널</label>
            <select className="ak-input" value={draft.terminalId} onChange={(e) => setDraft({ ...draft, terminalId: e.target.value })}>
              <option value="">미지정</option>
              {terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="ak-field">
            <label>대표자명</label>
            <input className="ak-input" value={draft.rep} onChange={(e) => setDraft({ ...draft, rep: e.target.value })} placeholder="예) 홍길동" />
          </div>
          <div className="ak-field">
            <label>사업자등록번호</label>
            <input className="ak-input" inputMode="numeric" value={draft.regNo} onChange={(e) => setDraft({ ...draft, regNo: formatRegNo(e.target.value) })} placeholder="000-00-00000" />
          </div>
          <div className="ak-field">
            <label>메모</label>
            <textarea className="ak-input ak-textarea" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="배송 시 주의사항 등" />
          </div>
          {editing && shippingRates && (
            <div className="ak-field">
              <label>정산 배송비 기본 금액 (박스당, 원)</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {SHIPPING_METHODS.map((m) => {
                  const blocked = m.key === 'quick' && !!draft.terminalId && quickAllowed?.[draft.terminalId] === false;
                  return (
                    <label key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 6rem' }}>
                      <span className="ak-sub">{m.label}</span>
                      <input
                        className="ak-input"
                        inputMode="numeric"
                        style={{ textAlign: 'right' }}
                        placeholder="사용 안 함"
                        disabled={blocked}
                        aria-label={`${m.label} 박스당 금액`}
                        value={blocked ? '' : draft[m.key]}
                        onChange={(e) => setDraft({ ...draft, [m.key]: formatWonDraft(e.target.value) })}
                      />
                    </label>
                  );
                })}
              </div>
              <p className="ak-sub" style={{ margin: 0 }}>
                {draft.terminalId && quickAllowed?.[draft.terminalId] === false ? '이 고객사의 터미널은 퀵이 안 되는 곳이라 퀵 금액은 쓰지 않습니다. ' : ''}
                비워 두면 그 수단은 정산에 제안하지 않습니다. 정산의 배송비 구역에서 이 금액으로 줄을 제안하고, 날짜별 금액은 거기서 고칩니다.
              </p>
            </div>
          )}
          {panel === 'new' && shippingRates && <p className="ak-sub" style={{ margin: 0 }}>정산 배송비 기본 금액은 고객사를 저장한 뒤 다시 열어 정합니다.</p>}
          {editing && (
            <p className="ak-meta">{editing.created_via === 'order' ? '주문입력' : '수기입력'}으로 {editing.created_at.slice(0, 10).replace(/-/g, '.')} 등록</p>
          )}
          </FieldGroup>
          {error && <p className="ak-error" role="alert">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
