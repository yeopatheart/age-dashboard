'use client';
import { useMemo, useRef, useState } from 'react';
import { Landmark, Plus, Stamp, Trash2 } from 'lucide-react';
import { deleteSeller, saveSeller, saveSellerSeal, type SellerInput } from './actions';
import { sealFileToDataUrl } from './seal-file';
import { useCan } from '@/components/permissions-context';
import { formatRegistrationInput, formatRegistrationNo } from '@/lib/sellers';
import { AdminHeader, ColumnMenu, DataTable, DeleteFooter, SearchInput, SidePanel, useHiddenColumns, useNotice, type Column } from '@/components/admin/admin-kit';

interface Seller {
  id: string;
  name: string;
  representative_name: string | null;
  registration_no: string;
  opened_on: string | null;
  address: string | null;
  business_type: string | null;
  business_item: string | null;
  memo: string | null;
  created_at: string;
}

const EMPTY: SellerInput = { name: '', representativeName: '', registrationNo: '', openedOn: '', address: '', businessType: '', businessItem: '', memo: '' };

const draftOf = (s: Seller): SellerInput => ({
  id: s.id,
  name: s.name,
  representativeName: s.representative_name ?? '',
  registrationNo: formatRegistrationNo(s.registration_no),
  openedOn: s.opened_on ?? '',
  address: s.address ?? '',
  businessType: s.business_type ?? '',
  businessItem: s.business_item ?? '',
  memo: s.memo ?? '',
});

// seals: 사업자 id → 직인 PNG data URL(없으면 null). 마이그레이션 0047 적용 전이면 seals 자체가 null이다.
export function SellersClient({ sellers, seals }: { sellers: Seller[]; seals: Record<string, string | null> | null }) {
  const can = useCan();
  const canEdit = can('sellers:edit');
  const canDelete = can('sellers:delete');
  const [search, setSearch] = useState('');
  // 'new' = 새 사업자 등록 패널, 사업자 id = 수정 패널, null = 닫힘
  const [panel, setPanel] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<SellerInput>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useHiddenColumns('ak-cols-sellers');
  const fileInput = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    if (!k) return sellers;
    const digits = k.replace(/\D/g, '');
    return sellers.filter(
      (s) =>
        s.name.toLowerCase().includes(k) ||
        (s.representative_name ?? '').toLowerCase().includes(k) ||
        (digits !== '' && s.registration_no.includes(digits)),
    );
  }, [sellers, search]);

  const open = panel && panel !== 'new' ? sellers.find((s) => s.id === panel) ?? null : null;
  const set = <K extends keyof SellerInput>(key: K, value: SellerInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const openNew = () => {
    setDraft(EMPTY);
    setPanel('new');
    setConfirmDelete(false);
    setError(null);
    setNotice(null);
  };
  const openSeller = (s: Seller) => {
    setDraft(draftOf(s));
    setPanel(s.id);
    setConfirmDelete(false);
    setError(null);
    setNotice(null);
  };

  const run = async (fn: () => Promise<{ error: string | null }>, okNotice: string) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await fn();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    setNotice(okNotice);
    return true;
  };

  const handleSave = async () => {
    const isNew = panel === 'new';
    if (await run(() => saveSeller(isNew ? { ...draft, id: undefined } : draft), isNew ? `'${draft.name.trim()}'을(를) 등록했습니다.` : `'${draft.name.trim()}' 정보를 저장했습니다.`)) setPanel(null);
  };

  // 직인은 사업자 정보 저장과 따로 올리는 즉시 저장한다(파일을 고르면 줄여서 바로 저장).
  const handleSealFile = async (sellerId: string, file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      try {
        return await saveSellerSeal(sellerId, await sealFileToDataUrl(file));
      } catch (e) {
        return { error: e instanceof Error ? e.message : '직인을 올리지 못했습니다.' };
      }
    }, '직인을 저장했습니다.');
    if (fileInput.current) fileInput.current.value = '';
  };

  const columns: Column<Seller>[] = [
    { key: 'name', label: '상호', hideable: false, render: (s) => <strong>{s.name}</strong> },
    { key: 'rep', label: '대표자', render: (s) => s.representative_name ?? <span className="ak-muted">-</span> },
    { key: 'no', label: '사업자등록번호', render: (s) => formatRegistrationNo(s.registration_no) },
    { key: 'opened', label: '개업일', render: (s) => (s.opened_on ? s.opened_on.replace(/-/g, '.') : <span className="ak-muted">-</span>) },
    { key: 'type', label: '업태', render: (s) => s.business_type ?? <span className="ak-muted">-</span> },
    { key: 'item', label: '종목', render: (s) => s.business_item ?? <span className="ak-muted">-</span> },
    { key: 'address', label: '사업장 소재지', render: (s) => s.address ?? <span className="ak-muted">-</span> },
    { key: 'seal', label: '직인', render: (s) => (seals?.[s.id] ? '등록됨' : <span className="ak-muted">-</span>) },
    { key: 'memo', label: '메모', render: (s) => s.memo ?? <span className="ak-muted">-</span> },
  ];

  // 저장하지 않은 입력이 있는지(패널을 닫을 때 확인을 받는다)
  const dirty = !!panel && canEdit && JSON.stringify(draft) !== JSON.stringify(open ? draftOf(open) : EMPTY);
  const saveDisabled = busy || !draft.name.trim() || formatRegistrationInput(draft.registrationNo).replace(/\D/g, '').length !== 10;

  return (
    <div className="ak-page">
      <AdminHeader icon={<Landmark size={20} />} title="사업자 관리" sub="판매·매입 건을 어느 사업자 명의로 처리하는지 구분할 때 쓰는 우리 쪽 사업자등록 정보입니다. 사업자등록증의 내용을 등록해 두면 정산에서 드롭다운으로 고릅니다." />

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="상호·대표자·등록번호 검색" />
        <span className="ak-count">{filtered.length}곳{filtered.length !== sellers.length ? ` / 전체 ${sellers.length}곳` : ''}</span>
        <span className="ak-spacer" />
        {canEdit && (
          <button className="ak-btn ak-btn-primary" onClick={openNew} disabled={busy}>
            <Plus size={14} /> 사업자 추가
          </button>
        )}
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
      </div>

      {error && !panel && <p className="ak-error" role="alert">{error}</p>}
      {notice && <p className="ak-notice" role="status">{notice}</p>}

      <DataTable
        columns={columns}
        hidden={hidden}
        rows={filtered}
        rowKey={(s) => s.id}
        onRowClick={openSeller}
        activeKey={open?.id ?? null}
        emptyText={sellers.length === 0 ? '등록된 사업자가 없습니다. 오른쪽 위 “사업자 추가”로 등록하세요.' : '조건에 맞는 사업자가 없습니다.'}
      />

      {panel && (
        <SidePanel
          title={panel === 'new' ? '사업자 등록' : '사업자 상세'}
          onClose={() => setPanel(null)}
          dirty={dirty}
          readOnly={!canEdit}
          footer={
            confirmDelete && open ? (
              <DeleteFooter
                name={open.name}
                consequence="이 사업자로 구분된 판매·매입 내역은 구분이 비게 됩니다."
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  if (await run(() => deleteSeller(open.id), `'${open.name}'을(를) 삭제했습니다.`)) setPanel(null);
                }}
              />
            ) : (
              <>
                {canDelete && open && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setPanel(null)}>닫기</button>
                {canEdit && <button className="ak-btn ak-btn-primary" disabled={saveDisabled} onClick={handleSave}>{panel === 'new' ? '등록' : '저장'}</button>}
              </>
            )
          }
        >
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div className="ak-field">
              <label>상호(법인명) *</label>
              <input className="ak-input" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
            </div>
            <div className="ak-field">
              <label>사업자등록번호 *</label>
              <input className="ak-input" inputMode="numeric" placeholder="000-00-00000" value={draft.registrationNo} onChange={(e) => set('registrationNo', formatRegistrationInput(e.target.value))} />
              <span className="ak-meta">숫자 10자리. 하이픈은 자동으로 들어갑니다.</span>
            </div>
            <div className="ak-field">
              <label>대표자(성명)</label>
              <input className="ak-input" value={draft.representativeName} onChange={(e) => set('representativeName', e.target.value)} maxLength={40} />
            </div>
            <div className="ak-field">
              <label>개업연월일</label>
              <input className="ak-input" type="date" value={draft.openedOn} onChange={(e) => set('openedOn', e.target.value)} />
            </div>
            <div className="ak-field">
              <label>사업장 소재지</label>
              <input className="ak-input" value={draft.address} onChange={(e) => set('address', e.target.value)} maxLength={200} />
            </div>
            <div className="ak-field">
              <label>업태</label>
              <input className="ak-input" value={draft.businessType} onChange={(e) => set('businessType', e.target.value)} maxLength={60} />
            </div>
            <div className="ak-field">
              <label>종목</label>
              <input className="ak-input" value={draft.businessItem} onChange={(e) => set('businessItem', e.target.value)} maxLength={60} />
            </div>
            <div className="ak-field">
              <label>메모</label>
              <textarea className="ak-input ak-textarea" value={draft.memo} onChange={(e) => set('memo', e.target.value)} maxLength={500} />
            </div>
          </fieldset>

          <div className="ak-field" style={{ marginTop: '0.9rem' }}>
            <label>직인(도장)</label>
            {panel === 'new' ? (
              <span className="ak-meta">사업자를 먼저 등록한 뒤 상세에서 직인을 올릴 수 있습니다.</span>
            ) : seals === null ? (
              <span className="ak-meta">직인을 쓰려면 마이그레이션 0047_settlement_receipts.sql을 먼저 적용해주세요.</span>
            ) : open ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ width: 96, height: 96, border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {seals[open.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL이라 next/image 최적화 대상이 아니다
                      <img src={seals[open.id] ?? undefined} alt={`${open.name} 직인`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                      <Stamp size={28} className="ak-muted" aria-hidden />
                    )}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <button type="button" className="ak-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
                        {seals[open.id] ? '직인 바꾸기' : '직인 올리기'}
                      </button>
                      {seals[open.id] && (
                        <button type="button" className="ak-btn ak-btn-danger" disabled={busy} onClick={() => void run(() => saveSellerSeal(open.id, null), '직인을 삭제했습니다.')}>
                          직인 삭제
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void handleSealFile(open.id, e.target.files?.[0])} />
                <span className="ak-meta">영수증의 “(인)” 자리에 찍힙니다. 배경이 투명한 PNG가 가장 깔끔합니다. 올리면 자동으로 작게 줄여 저장하고, 공개 주소 없이 이 시스템 안에서만 쓰입니다.</span>
              </>
            ) : null}
          </div>
          {error && <p className="ak-error" role="alert">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
