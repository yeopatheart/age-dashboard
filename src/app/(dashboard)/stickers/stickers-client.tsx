'use client';
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Stamp, Trash2 } from 'lucide-react';
import { createSticker, updateSticker, setStickerColor, moveSticker, deleteSticker } from './actions';
import { ColorPicker } from '@/components/color-picker';
import { resolveColors } from '@/lib/color-palette';
import { STICKER_DEFAULT_COLOR, STICKER_LABEL_MAX } from '@/lib/stickers';
import { useCan } from '@/components/permissions-context';
import { AdminHeader, DataTable, SidePanel, Toggle, DeleteFooter, type Column } from '@/components/admin/admin-kit';

interface Sticker {
  id: string;
  label: string;
  fill_color: string;
  border_color: string;
  uses_quantity: boolean;
  sort_order: number;
  created_at: string;
}

// 칠판에 붙는 모양 그대로의 견본. 수량을 쓰는 스티커는 "이름 1"처럼 보인다.
function StickerPreview({ label, fill, border, usesQuantity }: { label: string; fill: string; border: string; usesQuantity: boolean }) {
  const c = resolveColors(fill, border);
  return (
    <span className="ak-badge" style={{ background: c.fill, borderColor: c.border, color: c.text }}>
      {label}
      {usesQuantity ? ' 1' : ''}
    </span>
  );
}

export function StickersClient({ presets }: { presets: Sticker[] }) {
  const can = useCan();
  const canEdit = can('stickers:edit');
  const canDelete = can('stickers:delete');
  const [newLabel, setNewLabel] = useState('');
  const [newUsesQuantity, setNewUsesQuantity] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 색·수량 사용은 누르는 즉시 저장하고 화면에도 바로 반영한다(서버 갱신을 기다리지 않는다).
  const [local, setLocal] = useState<Record<string, Partial<Sticker>>>({});
  const view = (s: Sticker): Sticker => ({ ...s, ...local[s.id] });
  const rows = presets.map(view);
  const open = openId ? rows.find((s) => s.id === openId) ?? null : null;

  const run = async (fn: () => Promise<{ error: string | null }>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await fn().catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    return true;
  };

  const addInputRef = useRef<HTMLInputElement>(null);
  const handleAdd = async () => {
    if (!newLabel.trim()) {
      addInputRef.current?.focus();
      return;
    }
    if (await run(() => createSticker(newLabel, newUsesQuantity))) {
      setNewLabel('');
      setNewUsesQuantity(false);
    }
  };
  const setUsesQuantity = async (s: Sticker, value: boolean) => {
    const previous = s.uses_quantity;
    setLocal((p) => ({ ...p, [s.id]: { ...p[s.id], uses_quantity: value } }));
    const result = await updateSticker(s.id, s.label, value).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    if (result.error) {
      setLocal((p) => ({ ...p, [s.id]: { ...p[s.id], uses_quantity: previous } }));
      setError(result.error);
    }
  };
  // 색 선택기의 "기본으로"는 둘 다 null을 보낸다. 스티커는 색이 항상 있어야 하므로 기본색으로 돌린다.
  const setColor = async (s: Sticker, fillPick: string | null, borderPick: string | null) => {
    const fill = fillPick ?? STICKER_DEFAULT_COLOR;
    const border = borderPick ?? STICKER_DEFAULT_COLOR;
    const previous = { fill_color: s.fill_color, border_color: s.border_color };
    setLocal((p) => ({ ...p, [s.id]: { ...p[s.id], fill_color: fill, border_color: border } }));
    const result = await setStickerColor(s.id, fill, border).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    if (result.error) {
      setLocal((p) => ({ ...p, [s.id]: { ...p[s.id], ...previous } }));
      setError(result.error);
    }
  };
  const openPanel = (s: Sticker) => {
    setOpenId(s.id);
    setLabelDraft(s.label);
    setConfirmDelete(false);
    setError(null);
  };

  const columns: Column<Sticker>[] = [
    {
      key: 'order',
      label: '순서',
      hideable: false,
      render: (s) => {
        const index = rows.findIndex((r) => r.id === s.id);
        return (
          <span style={{ display: 'inline-flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            <button className="ak-btn" aria-label={`${s.label} 위로`} disabled={!canEdit || busy || index === 0} onClick={() => run(() => moveSticker(s.id, 'up'))}>
              <ArrowUp size={14} />
            </button>
            <button className="ak-btn" aria-label={`${s.label} 아래로`} disabled={!canEdit || busy || index === rows.length - 1} onClick={() => run(() => moveSticker(s.id, 'down'))}>
              <ArrowDown size={14} />
            </button>
          </span>
        );
      },
    },
    {
      key: 'label',
      label: '스티커',
      hideable: false,
      render: (s) => <StickerPreview label={s.label} fill={s.fill_color} border={s.border_color} usesQuantity={s.uses_quantity} />,
    },
    {
      key: 'quantity',
      label: '수량 입력',
      hideable: false,
      render: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Toggle checked={s.uses_quantity} onChange={(v) => setUsesQuantity(s, v)} label={`${s.label} 수량 입력`} disabled={!canEdit} />
        </span>
      ),
    },
  ];

  return (
    <div className="ak-page">
      <AdminHeader icon={<Stamp size={20} />} title="스티커 관리" sub="칠판의 상품 칸에 붙이는 스티커 목록입니다. 행을 누르면 이름과 색을 바꿀 수 있습니다." />

      <div className="ak-toolbar">
        <span className="ak-count">{rows.length}개</span>
        <span className="ak-spacer" />
        {canEdit && (
          <div className="ak-quick-add">
            <input
              ref={addInputRef}
              placeholder={`새 스티커 (예: 특대, 냉동실, ${STICKER_LABEL_MAX}자까지)`}
              value={newLabel}
              maxLength={STICKER_LABEL_MAX * 2}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="ak-sub">수량 입력</span>
              <Toggle checked={newUsesQuantity} onChange={setNewUsesQuantity} label="새 스티커 수량 입력" />
            </label>
            <button className="ak-btn ak-btn-primary" onClick={handleAdd} disabled={busy}>
              <Plus size={14} /> 추가
            </button>
          </div>
        )}
      </div>

      {error && !open && <p className="ak-error" role="alert">{error}</p>}

      <DataTable
        columns={columns}
        hidden={new Set()}
        rows={rows}
        rowKey={(s) => s.id}
        onRowClick={openPanel}
        activeKey={openId}
        emptyText="등록된 스티커가 없습니다. 위에서 추가해 주세요."
      />

      {open && (
        <SidePanel
          title="스티커 상세"
          onClose={() => setOpenId(null)}
          dirty={canEdit && labelDraft !== open.label}
          readOnly={!canEdit}
          footer={
            confirmDelete ? (
              <DeleteFooter
                name={open.label}
                consequence="이미 상품 칸에 붙은 스티커는 그대로 남습니다."
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  if (await run(() => deleteSticker(open.id))) setOpenId(null);
                  else setConfirmDelete(false);
                }}
              />
            ) : (
              <>
                {canDelete && (
                  <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} /> 삭제
                  </button>
                )}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setOpenId(null)}>닫기</button>
                {canEdit && (
                  <button
                    className="ak-btn ak-btn-primary"
                    disabled={busy || !labelDraft.trim() || labelDraft.trim() === open.label}
                    onClick={() => run(() => updateSticker(open.id, labelDraft, open.uses_quantity))}
                  >
                    이름 저장
                  </button>
                )}
              </>
            )
          }
        >
          <div className="ak-field">
            <label>스티커 이름</label>
            <input className="ak-input" value={labelDraft} maxLength={STICKER_LABEL_MAX * 2} onChange={(e) => setLabelDraft(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="ak-setting">
            <span>
              수량 입력
              <small>켜면 칠판에서 붙일 때 숫자 키패드가 떠서 &apos;특대 1&apos;처럼 수량을 함께 적습니다. 끄면 바로 붙습니다(예: 냉동실)</small>
            </span>
            <Toggle checked={open.uses_quantity} onChange={(v) => setUsesQuantity(open, v)} label="수량 입력" disabled={!canEdit} />
          </div>
          <div className="ak-field">
            <span className="ak-field-label">색상</span>
            <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <ColorPicker fill={open.fill_color} border={open.border_color} onChange={(f, b) => setColor(open, f, b)} sample={open.uses_quantity ? `${open.label} 1` : open.label} />
            </fieldset>
          </div>
          {error && <p className="ak-error" role="alert">{error}</p>}
        </SidePanel>
      )}
    </div>
  );
}
