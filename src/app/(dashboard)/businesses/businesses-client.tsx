'use client';
import { useMemo, useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { createBusiness, updateBusiness, deleteBusiness, setBusinessSettlementFields } from './actions';
import type { BusinessFields } from '@/lib/settlement/shipping-settings';
import { terminalBadgeProps, type TerminalColorMap } from '@/lib/terminal-color';
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

// legalName: 사업자명(법인·회사명), sellerId: 사업자구분(우리 사업자), usesQuick: 퀵 이용(0063)
type Draft = { name: string; terminalId: string; notes: string; regNo: string; rep: string; legalName: string; sellerId: string; usesQuick: boolean };
const EMPTY_DRAFT: Draft = { name: '', terminalId: '', notes: '', regNo: '', rep: '', legalName: '', sellerId: '', usesQuick: false };
const fieldsToDraft = (f: BusinessFields | undefined): Pick<Draft, 'legalName' | 'sellerId' | 'usesQuick'> => ({ legalName: f?.legalName ?? '', sellerId: f?.sellerId ?? '', usesQuick: f?.usesQuick ?? false });

// 입력하는 동안 숫자만 남기고 000-00-00000 모양으로 하이픈을 넣어 준다(최대 10자리).
const formatRegNo = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 10);
  return d.length <= 3 ? d : d.length <= 5 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

// fields: 고객사 id → 사업자명·사업자구분·퀵 이용(0063), sellers: 사업자구분으로 고를 우리 사업자. fields가 null이면 마이그레이션 전이라 그 칸을 숨긴다.
export function BusinessesClient({ businesses, terminals, fields, sellers }: { businesses: Business[]; terminals: Terminal[]; fields: Record<string, BusinessFields> | null; sellers: { id: string; name: string }[] }) {
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
            (fields?.[b.id]?.legalName ?? '').toLowerCase().includes(k) ||
            (b.business_registration_no ?? '').replace(/-/g, '').includes(k.replace(/-/g, ''))
          : true,
      )
      .filter((b) => (terminalFilter === 'all' ? true : terminalFilter === 'none' ? !b.terminal_id : b.terminal_id === terminalFilter))
      .filter((b) => (viaFilter === 'all' ? true : b.created_via === viaFilter));
    return [...list].sort((a, b) => (sort === 'recent' ? b.created_at.localeCompare(a.created_at) : a.name.localeCompare(b.name, 'ko')));
  }, [businesses, fields, search, terminalFilter, viaFilter, sort]);

  const editing = panel && panel !== 'new' ? businesses.find((b) => b.id === panel) ?? null : null;
  // 저장하지 않은 입력이 있는지(패널을 닫을 때 확인을 받는다)
  const baseline: Draft = panel === 'new' ? { ...EMPTY_DRAFT, terminalId: terminals[0]?.id ?? '' } : editing ? { name: editing.name, terminalId: editing.terminal_id ?? '', notes: editing.notes ?? '', regNo: editing.business_registration_no ?? '', rep: editing.representative_name ?? '', ...fieldsToDraft(fields?.[editing.id]) } : EMPTY_DRAFT;
  const dirty = !!panel && canEdit && JSON.stringify(draft) !== JSON.stringify(baseline);

  const openNew = () => {
    setPanel('new');
    setDraft({ ...EMPTY_DRAFT, terminalId: terminals[0]?.id ?? '' });
    setConfirmDelete(false);
    setError(null);
  };
  const openEdit = (b: Business) => {
    setPanel(b.id);
    setDraft({ name: b.name, terminalId: b.terminal_id ?? '', notes: b.notes ?? '', regNo: b.business_registration_no ?? '', rep: b.representative_name ?? '', ...fieldsToDraft(fields?.[b.id]) });
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
    const settlementFields = { legalName: draft.legalName, sellerId: draft.sellerId || null, usesQuick: draft.usesQuick };
    const ok = await run(async () => {
      if (panel === 'new') return createBusiness(draft.name, terminalId, notes, info, fields ? settlementFields : undefined);
      const saved = await updateBusiness(panel as string, draft.name, terminalId, notes, info);
      if (saved.error || !fields) return saved;
      return setBusinessSettlementFields(panel as string, settlementFields);
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
    ...(fields
      ? [
          { key: 'legalName', label: '사업자명', render: (b: Business) => (fields[b.id]?.legalName ? <span>{fields[b.id].legalName}</span> : <span className="ak-muted">—</span>) } satisfies Column<Business>,
          {
            key: 'seller',
            label: '사업자구분',
            render: (b: Business) => {
              const id = fields[b.id]?.sellerId;
              const name = id ? sellers.find((x) => x.id === id)?.name : undefined;
              return name ? <span>{name}</span> : <span className="ak-muted">미지정</span>;
            },
          } satisfies Column<Business>,
          { key: 'quick', label: '퀵', render: (b: Business) => (fields[b.id]?.usesQuick ? <span>이용</span> : <span className="ak-muted">—</span>) } satisfies Column<Business>,
        ]
      : []),
    { key: 'rep', label: '대표자', render: (b) => (b.representative_name ? <span>{b.representative_name}</span> : <span className="ak-muted">—</span>) },
    { key: 'regNo', label: '사업자등록번호', render: (b) => (b.business_registration_no ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{b.business_registration_no}</span> : <span className="ak-muted">—</span>) },
    { key: 'notes', label: '메모', render: (b) => (b.notes ? <span className="ak-ellipsis ak-muted">{b.notes}</span> : <span className="ak-muted">—</span>) },
    { key: 'via', label: '등록', render: (b) => <ViaTag via={b.created_via} date={b.created_at} /> },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<Building2 size={20} />} title="고객사 관리" sub="업체별로 보낼 터미널을 정해두면 주문이 들어올 때마다 다시 고르지 않아도 됩니다. 행을 누르면 수정할 수 있습니다." />

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="고객사·사업자명·대표자·사업자번호·메모 검색" />
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
          {fields && (
            <>
              <div className="ak-field">
                <label>사업자명</label>
                <input className="ak-input" value={draft.legalName} onChange={(e) => setDraft({ ...draft, legalName: e.target.value })} maxLength={100} placeholder="실제 법인·회사명 (예: 주식회사 ○○)" />
              </div>
              <div className="ak-field">
                <label>사업자구분</label>
                <select className="ak-input" value={draft.sellerId} onChange={(e) => setDraft({ ...draft, sellerId: e.target.value })}>
                  <option value="">미지정</option>
                  {sellers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <p className="ak-sub" style={{ margin: 0 }}>이 업체에 공급자로 쓰는 우리 사업자입니다. 정산 판매내역·배송비·영수증의 사업자 구분 기본값이 됩니다(정산에서 줄마다 바꿀 수도 있습니다).</p>
              </div>
              <div className="ak-setting">
                <span>
                  퀵 이용
                  <small>퀵 가능 터미널에서 퀵을 쓰는 고객사입니다. 켜면 정산 배송비에 퀵을 제안합니다(정산에서 그날만 뺄 수도 있습니다)</small>
                </span>
                <Toggle checked={draft.usesQuick} onChange={(v) => setDraft({ ...draft, usesQuick: v })} label="퀵 이용" disabled={!canEdit} />
              </div>
            </>
          )}
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
