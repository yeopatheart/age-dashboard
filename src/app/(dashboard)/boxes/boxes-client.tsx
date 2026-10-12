'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Plus, Trash2 } from 'lucide-react';
import { createBox, updateBox, deleteBox, setBoxActive, type BoxFields } from './actions';
import {
  AdminHeader,
  ColumnMenu,
  DataTable,
  FilterSelect,
  SearchInput,
  SidePanel,
  Toggle,
  useHiddenColumns,
  type Column,
} from '@/components/admin/admin-kit';

interface Box {
  id: string;
  name: string;
  notes: string | null;
  inner_width_cm: number | null;
  inner_depth_cm: number | null;
  inner_height_cm: number | null;
  is_mulbong_box: boolean;
  is_active: boolean;
}

interface BoxForm {
  name: string;
  width: string;
  depth: string;
  height: string;
  isMulbongBox: boolean;
  isActive: boolean;
  notes: string;
}

const EMPTY_FORM: BoxForm = { name: '', width: '', depth: '', height: '', isMulbongBox: false, isActive: true, notes: '' };

function toFields(form: BoxForm): BoxFields {
  return {
    name: form.name.trim(),
    innerWidthCm: form.width.trim() ? parseFloat(form.width) : null,
    innerDepthCm: form.depth.trim() ? parseFloat(form.depth) : null,
    innerHeightCm: form.height.trim() ? parseFloat(form.height) : null,
    isMulbongBox: form.isMulbongBox,
    isActive: form.isActive,
    notes: form.notes.trim() || null,
  };
}

function formatDims(b: Box) {
  const { inner_width_cm, inner_depth_cm, inner_height_cm } = b;
  if (inner_width_cm == null && inner_depth_cm == null && inner_height_cm == null) return null;
  return `${inner_width_cm ?? '?'} × ${inner_depth_cm ?? '?'} × ${inner_height_cm ?? '?'} cm`;
}

const toForm = (b: Box): BoxForm => ({
  name: b.name,
  width: b.inner_width_cm?.toString() ?? '',
  depth: b.inner_depth_cm?.toString() ?? '',
  height: b.inner_height_cm?.toString() ?? '',
  isMulbongBox: b.is_mulbong_box,
  isActive: b.is_active,
  notes: b.notes ?? '',
});

export function BoxesClient({ boxes }: { boxes: Box[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  // panel: null=닫힘, 'new'=새 박스, 그 외=수정할 박스 id
  const [panel, setPanel] = useState<string | null>(null);
  const [form, setForm] = useState<BoxForm>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useHiddenColumns('ak-cols-boxes');
  // 사용 여부 토글은 누르는 즉시 반영한다.
  const [localActive, setLocalActive] = useState<Record<string, boolean>>({});

  const isActive = (b: Box) => localActive[b.id] ?? b.is_active;
  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return boxes
      .filter((b) => (k ? b.name.toLowerCase().includes(k) || (b.notes ?? '').toLowerCase().includes(k) : true))
      .filter((b) => (activeFilter === 'all' ? true : activeFilter === 'active' ? (localActive[b.id] ?? b.is_active) : !(localActive[b.id] ?? b.is_active)))
      .filter((b) => (kindFilter === 'all' ? true : kindFilter === 'mulbong' ? b.is_mulbong_box : !b.is_mulbong_box));
  }, [boxes, localActive, search, activeFilter, kindFilter]);
  const editing = panel && panel !== 'new' ? boxes.find((b) => b.id === panel) ?? null : null;

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

  const openNew = () => {
    setPanel('new');
    setForm(EMPTY_FORM);
    setConfirmDelete(false);
    setError(null);
  };
  const openEdit = (b: Box) => {
    setPanel(b.id);
    setForm(toForm(b));
    setConfirmDelete(false);
    setError(null);
  };
  const handleSave = async () => {
    if (!form.name.trim()) return;
    const ok = await run(() => (panel === 'new' ? createBox(toFields(form)) : updateBox(panel as string, toFields(form))));
    if (ok) setPanel(null);
  };
  const handleToggleActive = async (b: Box, value: boolean) => {
    setLocalActive((p) => ({ ...p, [b.id]: value }));
    const result = await setBoxActive(b.id, value);
    if (result.error) {
      setLocalActive((p) => ({ ...p, [b.id]: !value }));
      setError(result.error);
      return;
    }
    router.refresh();
  };

  const columns: Column<Box>[] = [
    { key: 'name', label: '박스', hideable: false, render: (b) => <span className="ak-name">{b.name}</span> },
    { key: 'dims', label: '내측 크기 (가로×세로×높이)', render: (b) => formatDims(b) ?? <span className="ak-muted">미입력</span> },
    {
      key: 'mulbong',
      label: '용도',
      render: (b) => <span className={`ak-tag ${b.is_mulbong_box ? 'ak-tag-order' : 'ak-tag-manual'}`}>{b.is_mulbong_box ? '물봉용' : '일반'}</span>,
    },
    {
      key: 'active',
      label: '사용',
      render: (b) => <Toggle checked={isActive(b)} onChange={(v) => handleToggleActive(b, v)} label={`${b.name} 사용 여부`} />,
    },
    { key: 'notes', label: '메모', render: (b) => (b.notes ? <span className="ak-ellipsis ak-muted">{b.notes}</span> : <span className="ak-muted">—</span>) },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<Package size={20} />} title="박스 관리" sub="가게에서 쓰는 박스 종류와 내측 크기입니다. 사용 중인 박스만 포장 추천에 쓰입니다. 행을 누르면 수정할 수 있습니다." />

      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="박스·메모 검색" />
        <FilterSelect
          value={activeFilter}
          onChange={setActiveFilter}
          options={[{ value: 'all', label: '사용: 전체' }, { value: 'active', label: '사용중' }, { value: 'inactive', label: '미사용' }]}
        />
        <FilterSelect
          value={kindFilter}
          onChange={setKindFilter}
          options={[{ value: 'all', label: '용도: 전체' }, { value: 'mulbong', label: '물봉용' }, { value: 'normal', label: '일반' }]}
        />
        <span className="ak-count">{filtered.length}개{filtered.length !== boxes.length ? ` / 전체 ${boxes.length}개` : ''}</span>
        <span className="ak-spacer" />
        <ColumnMenu columns={columns} hidden={hidden} onChange={setHidden} />
        <button className="ak-btn ak-btn-primary" onClick={openNew}><Plus size={14} /> 박스 추가</button>
      </div>

      {error && !panel && <p className="ak-error">{error}</p>}

      <DataTable
        columns={columns}
        hidden={hidden}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={openEdit}
        activeKey={editing?.id ?? null}
        emptyText={boxes.length === 0 ? '등록된 박스가 없습니다.' : '조건에 맞는 박스가 없습니다.'}
      />

      {panel && (
        <SidePanel
          title={panel === 'new' ? '박스 추가' : '박스 상세'}
          onClose={() => setPanel(null)}
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
                    if (await run(() => deleteBox(panel))) setPanel(null);
                    else setConfirmDelete(false);
                  }}
                >삭제</button>
              </>
            ) : (
              <>
                {panel !== 'new' && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setPanel(null)}>취소</button>
                <button className="ak-btn ak-btn-primary" disabled={busy || !form.name.trim()} onClick={handleSave}>저장</button>
              </>
            )
          }
        >
          <div className="ak-field">
            <label>박스 이름 *</label>
            <input className="ak-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="예) 4호 스티로폼" />
          </div>
          <div className="ak-field">
            <span className="ak-field-label">내측 크기 (cm)</span>
            <div className="ak-row2">
              <input className="ak-input" type="number" min="0" step="0.1" placeholder="가로" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
              <input className="ak-input" type="number" min="0" step="0.1" placeholder="세로" value={form.depth} onChange={(e) => setForm({ ...form, depth: e.target.value })} />
              <input className="ak-input" type="number" min="0" step="0.1" placeholder="높이" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
            </div>
          </div>
          <div className="ak-setting">
            <span>물봉용 박스<small>산소 포장(물봉) 전용 박스입니다</small></span>
            <Toggle checked={form.isMulbongBox} onChange={(v) => setForm({ ...form, isMulbongBox: v })} label="물봉용" />
          </div>
          <div className="ak-setting">
            <span>사용중<small>꺼두면 포장 추천에서 제외됩니다</small></span>
            <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="사용중" />
          </div>
          <div className="ak-field">
            <label>메모</label>
            <textarea className="ak-input ak-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="ak-error">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
