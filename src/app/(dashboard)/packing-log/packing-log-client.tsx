'use client';
import '@/components/admin/admin.css';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, ClipboardList, GripVertical, Package, Plus, Trash2, X } from 'lucide-react';
import { submitPacking, deletePackingRecord } from './actions';

export interface PackingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  weightKg: number | null;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  needsMulbong: boolean;
}
export interface PackingBusiness {
  id: string;
  number: number;
  businessName: string;
  terminal: string;
  items: PackingItem[];
  submitted: {
    submittedAt: string;
    boxes: { boxId: string | null; boxName: string; items: { orderItemId: string; quantity: number }[] }[];
  } | null;
}
interface BoxType {
  id: string;
  name: string;
  is_active: boolean;
  inner_width_cm: number | null;
  inner_depth_cm: number | null;
  inner_height_cm: number | null;
  is_mulbong_box: boolean;
}

// 화면에서 작성 중인 박스 하나. uid는 화면 안에서만 쓰는 임시 식별자(같은 종류 박스를 여러 개 놓을 수 있다).
interface DraftBox {
  uid: string;
  boxId: string | null; // null = 삭제된 박스(이전 기록 불러올 때) — 제출 전에 지우거나 바꿔야 한다
  name: string;
  dims: string | null;
  isMulbong: boolean;
  items: { orderItemId: string; quantity: number }[];
}
interface Draft {
  boxes: DraftBox[];
  moveQty: Record<string, string>; // 상품별 "이번에 담을 수량" 입력값
  weights: Record<string, string>; // 상품별 실측 중량(선택)
}

const EPS = 0.0001;
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const dimsOf = (b: BoxType) =>
  b.inner_width_cm == null && b.inner_depth_cm == null && b.inner_height_cm == null
    ? null
    : `${b.inner_width_cm ?? '?'}×${b.inner_depth_cm ?? '?'}×${b.inner_height_cm ?? '?'}`;
let uidCounter = 0;
const newUid = () => `box-${Date.now()}-${uidCounter++}`;

export function PackingLogClient({
  orderDate,
  today,
  allowPast,
  rows,
  boxes,
}: {
  orderDate: string;
  today: string;
  allowPast: boolean;
  rows: PackingBusiness[];
  boxes: BoxType[];
}) {
  const router = useRouter();
  // 과거 날짜는 설정에서 "과거 날짜 편집"을 켰을 때만 제출·삭제할 수 있다(서버도 같은 규칙으로 막는다).
  const readOnly = orderDate !== today && !allowPast;
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [onlyPending, setOnlyPending] = useState(false);
  // 업체를 오가도 작성 중인 내용이 사라지지 않게 업체별로 보관한다(제출 전까지는 이 화면 메모리에만 있다).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeDrag, setActiveDrag] = useState<{ label: string; qty: number; unit: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeBoxes = boxes.filter((b) => b.is_active);
  const boxTypeById = new Map(boxes.map((b) => [b.id, b]));
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  const initialDraft = (row: PackingBusiness): Draft => ({
    // uid는 렌더마다 같은 값이어야 한다(작성 내용이 저장되기 전에는 이 함수가 매번 다시 불리므로).
    boxes: (row.submitted?.boxes ?? []).map((b, index) => {
      const type = b.boxId ? boxTypeById.get(b.boxId) : undefined;
      return {
        uid: `saved-${row.id}-${index}`,
        boxId: type ? type.id : null,
        name: b.boxName,
        dims: type ? dimsOf(type) : null,
        isMulbong: type?.is_mulbong_box ?? false,
        items: b.items,
      };
    }),
    moveQty: {},
    weights: Object.fromEntries(row.items.filter((i) => i.weightKg != null).map((i) => [i.id, String(i.weightKg)])),
  });
  const draft: Draft | null = selected ? drafts[selected.id] ?? initialDraft(selected) : null;
  const updateDraft = (fn: (d: Draft) => Draft) => {
    if (!selected || !draft) return;
    setDrafts((prev) => ({ ...prev, [selected.id]: fn(prev[selected.id] ?? initialDraft(selected)) }));
    setNotice(null);
  };

  const placedQty = (d: Draft, itemId: string) =>
    d.boxes.reduce((sum, b) => sum + b.items.filter((i) => i.orderItemId === itemId).reduce((s, i) => s + i.quantity, 0), 0);
  const remainingOf = (d: Draft, item: PackingItem) => Math.max(0, item.quantity - placedQty(d, item.id));

  const unplaced = useMemo(
    () => (selected && draft ? selected.items.filter((i) => remainingOf(draft, i) > EPS) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, draft],
  );
  const hasDeletedBox = !!draft?.boxes.some((b) => b.boxId === null);
  const canSubmit = !readOnly && !!draft && draft.boxes.length > 0 && unplaced.length === 0 && !hasDeletedBox && !busy && (selected?.items.length ?? 0) > 0;
  const submitHint = !draft
    ? ''
    : readOnly
      ? '과거 날짜는 설정에서 "과거 날짜 편집"을 켜면 제출할 수 있습니다'
      : draft.boxes.length === 0
      ? '오른쪽에서 박스를 추가해주세요'
      : hasDeletedBox
        ? '삭제된 박스가 있습니다. 해당 박스를 지우고 다른 박스를 추가해주세요'
        : unplaced.length > 0
          ? `아직 담지 않은 상품 ${unplaced.length}개`
          : '';

  // ─── 담기/옮기기/빼기 ─────────────────────────────────────────────────────
  const assign = (itemId: string, toUid: string, qty: number, fromUid?: string) =>
    updateDraft((d) => {
      const boxesNext = d.boxes.map((b) => {
        let items = b.items;
        if (fromUid && b.uid === fromUid) items = items.filter((i) => i.orderItemId !== itemId);
        if (b.uid === toUid) {
          const found = items.find((i) => i.orderItemId === itemId);
          items = found
            ? items.map((i) => (i.orderItemId === itemId ? { ...i, quantity: i.quantity + qty } : i))
            : [...items, { orderItemId: itemId, quantity: qty }];
        }
        return items === b.items ? b : { ...b, items };
      });
      return { ...d, boxes: boxesNext, moveQty: { ...d.moveQty, [itemId]: '' } };
    });
  const unassign = (itemId: string, fromUid: string) =>
    updateDraft((d) => ({
      ...d,
      boxes: d.boxes.map((b) => (b.uid === fromUid ? { ...b, items: b.items.filter((i) => i.orderItemId !== itemId) } : b)),
    }));
  const addBox = (type: BoxType) =>
    updateDraft((d) => ({
      ...d,
      boxes: [...d.boxes, { uid: newUid(), boxId: type.id, name: type.name, dims: dimsOf(type), isMulbong: type.is_mulbong_box, items: [] }],
    }));
  const removeBox = (uid: string) => updateDraft((d) => ({ ...d, boxes: d.boxes.filter((b) => b.uid !== uid) }));

  const parseMove = (d: Draft, item: PackingItem) => {
    const remaining = remainingOf(d, item);
    const typed = parseFloat(d.moveQty[item.id] ?? '');
    return Number.isFinite(typed) && typed > 0 ? Math.min(typed, remaining) : remaining;
  };

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { itemId: string; fromUid?: string } | undefined;
    const item = selected?.items.find((i) => i.id === data?.itemId);
    if (!item || !draft) return;
    const qty = data?.fromUid
      ? draft.boxes.find((b) => b.uid === data.fromUid)?.items.find((i) => i.orderItemId === item.id)?.quantity ?? 0
      : parseMove(draft, item);
    setActiveDrag({ label: item.name, qty, unit: item.unit });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    if (!e.over || !draft) return;
    const data = e.active.data.current as { itemId: string; fromUid?: string } | undefined;
    const item = selected?.items.find((i) => i.id === data?.itemId);
    if (!item || !data) return;
    const overId = String(e.over.id);
    if (overId === 'pool') {
      if (data.fromUid) unassign(item.id, data.fromUid);
      return;
    }
    if (!overId.startsWith('box:')) return;
    const toUid = overId.slice(4);
    if (data.fromUid) {
      if (data.fromUid === toUid) return;
      const qty = draft.boxes.find((b) => b.uid === data.fromUid)?.items.find((i) => i.orderItemId === item.id)?.quantity ?? 0;
      assign(item.id, toUid, qty, data.fromUid);
    } else {
      const qty = parseMove(draft, item);
      if (qty > EPS) assign(item.id, toUid, qty);
    }
  };

  // ─── 제출/삭제 ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selected || !draft || !canSubmit) return;
    setBusy(true);
    setError(null);
    const weights: Record<string, number | null> = {};
    for (const item of selected.items) {
      const raw = draft.weights[item.id];
      if (raw === undefined) continue;
      const n = parseFloat(raw);
      weights[item.id] = Number.isFinite(n) && n > 0 ? n : null;
    }
    const result = await submitPacking({
      dailyBusinessId: selected.id,
      boxes: draft.boxes.map((b) => ({ boxId: b.boxId as string, items: b.items })),
      weights,
    });
    setBusy(false);
    if (result.error) return setError(result.error);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selected.id]; // 제출한 내용으로 다시 불러오게 한다
      return next;
    });
    setNotice(`${selected.businessName} 박스 기록을 제출했습니다.`);
    router.refresh();
  };
  const handleDeleteRecord = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await deletePackingRecord(selected.id);
    setBusy(false);
    setConfirmDelete(false);
    if (result.error) return setError(result.error);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selected.id];
      return next;
    });
    router.refresh();
  };

  const go = (date: string) => router.push(`/packing-log?date=${date}`);
  const shift = (days: number) => {
    const d = new Date(`${orderDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= today) go(next);
  };

  const visibleRows = onlyPending ? rows.filter((r) => !r.submitted) : rows;
  const doneCount = rows.filter((r) => r.submitted).length;

  return (
    <div className="pk-root">
      <div className="page-header">
        <div className="page-header-icon"><ClipboardList size={20} /></div>
        <div>
          <h1 className="page-title">박스 기록</h1>
          <p className="page-sub">업체마다 박스를 고르고 상품을 끌어다 박스에 넣은 뒤 제출하세요. 제출한 기록만 저장되어 박스 추천 학습에 쓰입니다.</p>
        </div>
      </div>

      <div className="ak-toolbar">
        <button className="ak-btn" onClick={() => shift(-1)} title="전날"><ChevronLeft size={14} /></button>
        <input type="date" className="pk-date" value={orderDate} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
        <button className="ak-btn" onClick={() => shift(1)} disabled={orderDate >= today} title="다음날"><ChevronRight size={14} /></button>
        {orderDate !== today && <button className="ak-btn ak-btn-primary" onClick={() => go(today)}>오늘</button>}
        <span className="ak-count">업체 {rows.length}곳 · 제출 {doneCount}곳</span>
        <span className="ak-spacer" />
        <label className="pk-check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> 미기록 업체만</label>
      </div>

      {rows.length === 0 ? (
        <p className="ak-empty">이 날짜에 주문이 없습니다.</p>
      ) : (
        <div className="pk-layout">
          <aside className="pk-list">
            {visibleRows.length === 0 && <p className="ak-empty" style={{ padding: '1.5rem 0.5rem' }}>모두 제출했습니다.</p>}
            {visibleRows.map((r) => (
              <button key={r.id} className={`pk-biz ${r.id === selectedId ? 'pk-biz-on' : ''}`} onClick={() => { setSelectedId(r.id); setError(null); setNotice(null); setConfirmDelete(false); }}>
                <span className="pk-biz-top">
                  <span className="pk-biz-name">{r.businessName}</span>
                  {r.submitted ? <span className="ak-tag ak-tag-on">제출 · 박스 {r.submitted.boxes.length}</span> : <span className="ak-tag ak-tag-off">미기록</span>}
                </span>
                <span className="pk-biz-sub">{r.terminal || '터미널 없음'} · 상품 {r.items.length}개</span>
              </button>
            ))}
          </aside>

          {selected && draft && (
            <DndContext id="packing-dnd" sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDrag(null)}>
              <section className="pk-work">
                <div className="pk-work-head">
                  <div>
                    <div className="pk-title">{selected.businessName}</div>
                    <div className="ak-meta">{selected.terminal || '터미널 없음'} · 상품 {selected.items.length}개{selected.submitted ? ` · ${selected.submitted.submittedAt.slice(0, 16).replace('T', ' ')} 제출됨` : ''}</div>
                  </div>
                  <span className="ak-spacer" />
                  {selected.submitted && (
                    confirmDelete ? (
                      <>
                        <span className="ak-error">이 업체의 제출 기록을 삭제할까요?</span>
                        <button className="ak-btn" onClick={() => setConfirmDelete(false)}>취소</button>
                        <button className="ak-btn ak-btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={busy} onClick={handleDeleteRecord}>삭제</button>
                      </>
                    ) : (
                      <button className="ak-btn ak-btn-danger" disabled={readOnly} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 기록 삭제</button>
                    )
                  )}
                </div>

                <div className="pk-board">
                  <Pool items={unplaced} draft={draft} onMoveQty={(id, v) => updateDraft((d) => ({ ...d, moveQty: { ...d.moveQty, [id]: v } }))} onWeight={(id, v) => updateDraft((d) => ({ ...d, weights: { ...d.weights, [id]: v } }))} remainingOf={(i) => remainingOf(draft, i)} total={selected.items.length} />

                  <div className="pk-boxes">
                    <div className="pk-palette">
                      <span className="pk-palette-label"><Package size={14} /> 박스 추가</span>
                      {activeBoxes.length === 0 && <span className="ak-muted">사용 중인 박스가 없습니다 (박스 관리)</span>}
                      {activeBoxes.map((b) => (
                        <button key={b.id} className="pk-add-box" onClick={() => addBox(b)} title={dimsOf(b) ? `${dimsOf(b)} cm` : undefined}>
                          <Plus size={13} /> {b.name}{b.is_mulbong_box && <em>물봉</em>}
                        </button>
                      ))}
                    </div>
                    <div className="pk-slots">
                      {draft.boxes.length === 0 && <p className="pk-hint">위에서 박스를 추가한 뒤, 왼쪽 상품을 박스로 끌어다 놓으세요.</p>}
                      {draft.boxes.map((box, idx) => (
                        <BoxSlot key={box.uid} box={box} index={idx + 1} items={selected.items} onRemove={() => removeBox(box.uid)} onUnassign={(id) => unassign(id, box.uid)} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pk-foot">
                  {error && <span className="ak-error">{error}</span>}
                  {notice && <span className="ak-notice">{notice}</span>}
                  {!error && !notice && submitHint && <span className="ak-muted">{submitHint}</span>}
                  <span className="ak-spacer" />
                  <button className="ak-btn ak-btn-primary pk-submit" disabled={!canSubmit} onClick={handleSubmit}>
                    {busy ? '제출 중...' : selected.submitted ? `다시 제출 (박스 ${draft.boxes.length})` : `제출 (박스 ${draft.boxes.length})`}
                  </button>
                </div>
              </section>

              <DragOverlay>
                {activeDrag && (
                  <div className="pk-chip pk-chip-ghost">
                    <strong>{activeDrag.label}</strong> {fmt(activeDrag.qty)}{activeDrag.unit}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      )}

      <style>{`
        .pk-root { display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
        .pk-date { height: 2.25rem; border: 1px solid var(--border); border-radius: 999px; padding: 0 0.8rem; font-size: 0.875rem; font-weight: 700; background: #fff; }
        .pk-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 600; color: var(--muted-foreground); cursor: pointer; }
        .pk-layout { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 0.9rem; align-items: start; }
        .pk-list { display: flex; flex-direction: column; gap: 0.4rem; max-height: calc(100vh - 14rem); overflow-y: auto; }
        .pk-biz { text-align: left; background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 0.6rem 0.8rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.2rem; }
        .pk-biz:hover { background: #f8fafc; }
        .pk-biz-on { border-color: var(--primary); background: var(--primary-light); }
        .pk-biz-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
        .pk-biz-name { font-weight: 700; font-size: 0.875rem; }
        .pk-biz-sub { font-size: 0.75rem; color: var(--muted-foreground); }
        .pk-work { container-type: inline-size; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; min-width: 0; }
        .pk-work-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.85rem 1.1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .pk-title { font-size: 1.05rem; font-weight: 800; color: var(--primary); }
        .pk-board { display: grid; grid-template-columns: 19rem minmax(0, 1fr); gap: 1rem; padding: 1rem 1.1rem; min-height: 22rem; }
        .pk-pool { background: #f8fafc; border: 2px dashed #e2e8f0; border-radius: 12px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.5rem; }
        .pk-pool-over { border-color: var(--primary); background: var(--primary-light); }
        .pk-pool-title { font-size: 0.75rem; font-weight: 800; color: var(--muted-foreground); }
        .pk-chip { display: flex; align-items: center; gap: 0.35rem; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0.35rem 0.5rem; font-size: 0.8125rem; }
        .pk-chip-ghost { box-shadow: var(--shadow-md); border-color: var(--primary); padding: 0.45rem 0.8rem; }
        .pk-grip { display: flex; align-items: center; gap: 0.3rem; flex: 1; min-width: 0; cursor: grab; touch-action: none; user-select: none; }
        .pk-grip:active { cursor: grabbing; }
        .pk-name { font-weight: 700; word-break: keep-all; }
        .pk-qty { color: var(--muted-foreground); white-space: nowrap; }
        .pk-mini { width: 3.4rem; height: 1.7rem; border: 1px solid var(--border); border-radius: 8px; text-align: center; font-size: 0.75rem; background: #fff; }
        .pk-mulbong { font-size: 0.625rem; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 999px; padding: 0 0.35rem; }
        .pk-pool-row { display: flex; flex-direction: column; gap: 0.25rem; }
        .pk-pool-opts { display: flex; align-items: center; gap: 0.4rem; font-size: 0.6875rem; color: var(--muted-foreground); padding-left: 1.2rem; flex-wrap: wrap; }
        .pk-boxes { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
        .pk-palette { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
        .pk-palette-label { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; font-weight: 800; color: var(--muted-foreground); margin-right: 0.2rem; }
        .pk-add-box { display: inline-flex; align-items: center; gap: 0.3rem; height: 2rem; padding: 0 0.8rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.8125rem; font-weight: 700; cursor: pointer; }
        .pk-add-box:hover { background: var(--muted); }
        .pk-add-box em { font-style: normal; font-size: 0.625rem; color: #1d4ed8; }
        .pk-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.75rem; align-items: start; }
        .pk-hint { grid-column: 1 / -1; color: var(--muted-foreground); font-size: 0.875rem; padding: 2rem 0; text-align: center; border: 2px dashed #e2e8f0; border-radius: 12px; }
        .pk-slot { border: 2px solid #cbd5e1; border-radius: 14px; background: #fff; min-height: 9rem; display: flex; flex-direction: column; }
        .pk-slot-over { border-color: var(--primary); background: var(--primary-light); }
        .pk-slot-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.7rem; background: #f1f5f9; border-radius: 12px 12px 0 0; font-size: 0.8125rem; }
        .pk-slot-head strong { font-weight: 800; }
        .pk-slot-dims { color: var(--muted-foreground); font-size: 0.6875rem; }
        .pk-slot-body { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
        .pk-slot-empty { margin: auto; color: #94a3b8; font-size: 0.8125rem; }
        .pk-x { border: none; background: transparent; color: var(--muted-foreground); cursor: pointer; padding: 0.15rem; border-radius: 6px; display: inline-flex; }
        .pk-x:hover { background: #e2e8f0; color: var(--danger); }
        .pk-warn { font-size: 0.625rem; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 999px; padding: 0 0.35rem; }
        .pk-foot { display: flex; align-items: center; gap: 0.75rem; padding: 0.85rem 1.1rem; border-top: 1px solid var(--border); flex-wrap: wrap; }
        .pk-submit { height: 2.5rem; padding: 0 1.4rem; font-size: 0.9rem; }
        /* 작업 영역 폭이 좁으면(태블릿/좁은 창) 상품 영역을 박스 영역 위로 쌓는다. */
        @container (max-width: 52rem) { .pk-board { grid-template-columns: 1fr; } }
        @media (max-width: 900px) { .pk-layout { grid-template-columns: 1fr; } .pk-board { grid-template-columns: 1fr; } .pk-list { max-height: 14rem; flex-direction: row; overflow-x: auto; } .pk-biz { min-width: 11rem; } }
      `}</style>
    </div>
  );
}

// ─── 아직 안 담은 상품 영역(끌어서 되돌리는 곳이기도 하다) ────────────────────────
function Pool({
  items,
  draft,
  onMoveQty,
  onWeight,
  remainingOf,
  total,
}: {
  items: PackingItem[];
  draft: Draft;
  onMoveQty: (id: string, v: string) => void;
  onWeight: (id: string, v: string) => void;
  remainingOf: (i: PackingItem) => number;
  total: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' });
  return (
    <div ref={setNodeRef} className={`pk-pool ${isOver ? 'pk-pool-over' : ''}`}>
      <div className="pk-pool-title">아직 담지 않은 상품 ({items.length}/{total})</div>
      {items.length === 0 && <p className="ak-muted" style={{ fontSize: '0.8125rem' }}>모든 상품을 담았습니다. 박스에서 상품을 이쪽으로 끌어오면 다시 뺄 수 있습니다.</p>}
      {items.map((item) => (
        <PoolItem key={item.id} item={item} remaining={remainingOf(item)} moveQty={draft.moveQty[item.id] ?? ''} weight={draft.weights[item.id] ?? ''} onMoveQty={(v) => onMoveQty(item.id, v)} onWeight={(v) => onWeight(item.id, v)} />
      ))}
    </div>
  );
}

function PoolItem({
  item,
  remaining,
  moveQty,
  weight,
  onMoveQty,
  onWeight,
}: {
  item: PackingItem;
  remaining: number;
  moveQty: string;
  weight: string;
  onMoveQty: (v: string) => void;
  onWeight: (v: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `item:${item.id}`, data: { itemId: item.id } });
  const partial = remaining < item.quantity - EPS;
  return (
    <div className="pk-pool-row" style={{ opacity: isDragging ? 0.4 : 1 }}>
      <div className="pk-chip">
        <span ref={setNodeRef} className="pk-grip" {...listeners} {...attributes}>
          <GripVertical size={14} color="#94a3b8" />
          <span className="pk-name">{item.name}</span>
          <span className="pk-qty">{fmt(remaining)}{item.unit}{partial ? ` / ${fmt(item.quantity)}` : ''}</span>
          {item.needsMulbong && <span className="pk-mulbong">물봉</span>}
        </span>
      </div>
      <div className="pk-pool-opts">
        {remaining > 1 && (
          <label>
            담을 수량{' '}
            <input className="pk-mini" type="number" min="0" step="any" placeholder={fmt(remaining)} value={moveQty} onChange={(e) => onMoveQty(e.target.value)} />
          </label>
        )}
        <label>
          실측 kg{' '}
          <input className="pk-mini" type="number" min="0" step="any" placeholder="선택" value={weight} onChange={(e) => onWeight(e.target.value)} />
        </label>
        {item.sizeRequest && <span>({item.sizeRequest})</span>}
      </div>
    </div>
  );
}

// ─── 박스 칸 ────────────────────────────────────────────────────────────────
function BoxSlot({
  box,
  index,
  items,
  onRemove,
  onUnassign,
}: {
  box: DraftBox;
  index: number;
  items: PackingItem[];
  onRemove: () => void;
  onUnassign: (itemId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${box.uid}` });
  const itemById = new Map(items.map((i) => [i.id, i]));
  return (
    <div ref={setNodeRef} className={`pk-slot ${isOver ? 'pk-slot-over' : ''}`}>
      <div className="pk-slot-head">
        <strong>{index}번 박스</strong>
        <span>{box.name}</span>
        {box.isMulbong && <span className="pk-mulbong">물봉용</span>}
        {box.boxId === null && <span className="pk-warn">삭제된 박스</span>}
        {box.dims && <span className="pk-slot-dims">{box.dims}cm</span>}
        <span className="ak-spacer" />
        <button className="pk-x" onClick={onRemove} title="박스 빼기 (담은 상품은 다시 왼쪽으로 돌아갑니다)"><X size={14} /></button>
      </div>
      <div className="pk-slot-body">
        {box.items.length === 0 && <span className="pk-slot-empty">여기에 상품을 끌어다 놓으세요</span>}
        {box.items.map((bi) => {
          const item = itemById.get(bi.orderItemId);
          if (!item) return null;
          return <PlacedChip key={bi.orderItemId} item={item} qty={bi.quantity} fromUid={box.uid} mulbongMismatch={item.needsMulbong && !box.isMulbong} onRemove={() => onUnassign(bi.orderItemId)} />;
        })}
      </div>
    </div>
  );
}

function PlacedChip({
  item,
  qty,
  fromUid,
  mulbongMismatch,
  onRemove,
}: {
  item: PackingItem;
  qty: number;
  fromUid: string;
  mulbongMismatch: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `placed:${fromUid}:${item.id}`, data: { itemId: item.id, fromUid } });
  return (
    <div className="pk-chip" style={{ opacity: isDragging ? 0.4 : 1 }}>
      <span ref={setNodeRef} className="pk-grip" {...listeners} {...attributes}>
        <GripVertical size={14} color="#94a3b8" />
        <span className="pk-name">{item.name}</span>
        <span className="pk-qty">{fmt(qty)}{item.unit}{qty < item.quantity - EPS ? ` / ${fmt(item.quantity)}` : ''}</span>
        {mulbongMismatch && <span className="pk-warn" title="물봉 포장이 필요한 상품인데 물봉용 박스가 아닙니다">물봉 필요</span>}
      </span>
      <button className="pk-x" onClick={onRemove} title="박스에서 빼기"><X size={13} /></button>
    </div>
  );
}
