'use client';
import '@/components/admin/admin.css';
import { useMemo, useState } from 'react';
import Link from 'next/link';
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
import { BarChart3, ChevronLeft, ChevronRight, ClipboardList, GripVertical, Package, Plus, Trash2, X } from 'lucide-react';
import type { RecommendationView, StoredPlan } from '@/lib/packing/server';
import { submitPacking, assignItemsToBoxes, deletePackingRecord } from './actions';
import { LabelPanel } from './label-panel';

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
  // 같은 고객사가 1차·2차 모두 있을 때만 값이 있다
  roundLabel: string | null;
  terminal: string;
  items: PackingItem[];
  // 박스 추천(shadow test). 미제출 업체는 1순위 추천이 박스에 미리 채워진다.
  recommendation: RecommendationView | null;
  // 미제출: 추천을 만든 뒤 주문이 바뀜 / 제출: 제출한 뒤 주문이 바뀜
  orderChanged: boolean;
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
  // 상품 배치가 어디서 왔는지: 불러온 그대로(base) / 자동으로 다시 나눔(auto) / 사람이 직접 옮김(manual).
  // 직접 옮긴 경우만 "상품 배치를 사람이 확인함"으로 기록한다.
  source: 'base' | 'auto' | 'manual';
  // 이 작성본이 시작한 추천 순위(0부터). 수정했는지는 이 순위의 원래 구성과 비교해서 판단한다.
  baseRank: number;
}

const EPS = 0.0001;
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const dimsOf = (b: BoxType) =>
  b.inner_width_cm == null && b.inner_depth_cm == null && b.inner_height_cm == null
    ? null
    : `${b.inner_width_cm ?? '?'}×${b.inner_depth_cm ?? '?'}×${b.inner_height_cm ?? '?'}`;
const CONFIDENCE_LABEL = { high: '높음', medium: '보통', low: '낮음' } as const;
// "선어박스 1개 · 10K 2개" 처럼 박스 종류별 개수로 요약한다.
const namesLabel = (names: string[]) => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => `${name} ${n}개`).join(' · ');
};
const planLabel = (plan: StoredPlan) => namesLabel(plan.boxes.map((b) => b.boxName));
// 박스 구성+상품 배치를 비교용 문자열로 만든다(박스 순서와 무관). 원래 구성으로 되돌려 놓으면 "수정 안 함"으로 본다.
const layoutKey = (boxes: DraftBox[]) =>
  boxes
    .map((b) => `${b.boxId}:${b.items.map((i) => `${i.orderItemId}=${fmt(i.quantity)}`).sort().join(',')}`)
    .sort()
    .join('|');
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
  // 미제출 업체에서 지금 보고 있는 추천 후보(0부터). 수정 중이 아닐 때만 쓴다.
  const [ranks, setRanks] = useState<Record<string, number>>({});

  const activeBoxes = boxes.filter((b) => b.is_active);
  const boxTypeById = new Map(boxes.map((b) => [b.id, b]));
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  // 추천 후보(순위 rank, 0부터)를 화면 박스로 옮긴다. uid는 렌더마다 같은 값이어야 한다.
  const boxesFromPlan = (row: PackingBusiness, plan: StoredPlan, rank: number): DraftBox[] =>
    plan.boxes.map((b, index) => {
      const type = boxTypeById.get(b.boxId);
      return {
        uid: `rec${rank}-${row.id}-${index}`,
        boxId: type ? type.id : null,
        name: type?.name ?? b.boxName,
        dims: type ? dimsOf(type) : null,
        isMulbong: type?.is_mulbong_box ?? b.isMulbongBox,
        items: b.items,
      };
    });
  // 지금 화면에 보이는 박스 구성: 제출한 기록이 있으면 그것, 없으면 보고 있는 추천 후보.
  const rankOf = (row: PackingBusiness) => Math.min(ranks[row.id] ?? 0, Math.max(0, (row.recommendation?.candidates.length ?? 1) - 1));
  const baseBoxes = (row: PackingBusiness, rank: number): DraftBox[] => {
    if (row.submitted) {
      return row.submitted.boxes.map((b, index) => {
        const type = b.boxId ? boxTypeById.get(b.boxId) : undefined;
        return {
          uid: `saved-${row.id}-${index}`,
          boxId: type ? type.id : null,
          name: b.boxName,
          dims: type ? dimsOf(type) : null,
          isMulbong: type?.is_mulbong_box ?? false,
          items: b.items,
        };
      });
    }
    const plan = row.recommendation?.candidates[rank];
    return plan ? boxesFromPlan(row, plan, rank) : [];
  };
  // 항상 수정할 수 있다: 화면의 박스·상품이 곧 작성본이다. 건드리기 전에는 추천(또는 제출한 기록) 그대로이고,
  // 건드리면 그때부터 업체별로 보관한다(제출·되돌리기 전까지는 이 화면 메모리에만 있다).
  const makeDraft = (row: PackingBusiness, rank: number): Draft => ({
    boxes: baseBoxes(row, rank),
    moveQty: {},
    weights: Object.fromEntries(row.items.filter((i) => i.weightKg != null).map((i) => [i.id, String(i.weightKg)])),
    source: 'base',
    baseRank: rank,
  });
  const isModified = (row: PackingBusiness) => {
    const d = drafts[row.id];
    return !!d && layoutKey(d.boxes) !== layoutKey(baseBoxes(row, d.baseRank));
  };
  const rank = selected ? rankOf(selected) : 0;
  const draft: Draft | null = selected ? drafts[selected.id] ?? makeDraft(selected, rank) : null;
  const modified = !!selected && isModified(selected);
  const updateDraft = (fn: (d: Draft) => Draft) => {
    if (!selected) return;
    setDrafts((prev) => ({ ...prev, [selected.id]: fn(prev[selected.id] ?? makeDraft(selected, rankOf(selected))) }));
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
  const canSubmit = !readOnly && !!draft && draft.boxes.length > 0 && unplaced.length === 0 && !hasDeletedBox && !busy && (selected?.items.length ?? 0) > 0 && (!selected?.submitted || modified);
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
      return { ...d, boxes: boxesNext, moveQty: { ...d.moveQty, [itemId]: '' }, source: 'manual' };
    });
  const unassign = (itemId: string, fromUid: string) =>
    updateDraft((d) => ({
      ...d,
      boxes: d.boxes.map((b) => (b.uid === fromUid ? { ...b, items: b.items.filter((i) => i.orderItemId !== itemId) } : b)),
      source: 'manual',
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
      // 불러온 배치나 자동 배정을 그대로 제출하면 사람이 확인한 것으로 보지 않는다.
      itemsVerified: modified && draft.source === 'manual',
    });
    setBusy(false);
    if (result.error) return setError(result.error);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selected.id]; // 제출한 내용으로 다시 불러오게 한다
      return next;
    });
    setNotice(`${selected.businessName}${selected.roundLabel ? ` (${selected.roundLabel})` : ''} 박스 할당을 제출했습니다.`);
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

  // ─── 한 화면 흐름: 화면의 박스·상품이 곧 작성본이다. 건드리면 추천이 아니라 직접 입력으로 처리된다. ───────
  const resetToBase = () => {
    if (!selected) return;
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selected.id];
      return next;
    });
    setError(null);
    setNotice(null);
  };
  const selectRank = (i: number) => {
    if (!selected) return;
    resetToBase();
    setRanks((prev) => ({ ...prev, [selected.id]: i }));
  };
  const changeBoxType = (uid: string, boxId: string) => {
    const type = boxTypeById.get(boxId);
    if (!type) return;
    updateDraft((d) => ({ ...d, boxes: d.boxes.map((b) => (b.uid === uid ? { ...b, boxId: type.id, name: type.name, dims: dimsOf(type), isMulbong: type.is_mulbong_box } : b)) }));
  };
  // 박스를 바꾼 뒤 상품을 처음부터 옮기기 번거로울 때: 지금 박스 구성에 상품을 자동으로 다시 나눠 담는다.
  const handleAutoAssign = async () => {
    if (!selected || !draft || busy) return;
    setBusy(true);
    setError(null);
    const result = await assignItemsToBoxes({ dailyBusinessId: selected.id, boxIds: draft.boxes.map((b) => b.boxId as string) });
    setBusy(false);
    if (result.error) return setError(result.error);
    updateDraft((d) => ({ ...d, boxes: d.boxes.map((b, i) => ({ ...b, items: result.boxes[i]?.items ?? [] })), moveQty: {}, source: 'auto' }));
  };
  const canAutoAssign = !!draft && draft.boxes.length > 0 && !hasDeletedBox && (selected?.items.length ?? 0) > 0;

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
          <h1 className="page-title">박스 할당</h1>
          <p className="page-sub">추천된 박스와 담길 상품을 확인하세요. 맞으면 &ldquo;맞아요. 제출할게요.&rdquo;, 다르면 &ldquo;수정할게요.&rdquo;를 눌러 박스와 상품을 고친 뒤 제출하세요. 제출한 기록은 추천의 정확도 측정과 학습에 쓰입니다.</p>
        </div>
      </div>

      <div className="ak-toolbar">
        <button className="ak-btn" onClick={() => shift(-1)} title="전날"><ChevronLeft size={14} /></button>
        <input type="date" className="pk-date" value={orderDate} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
        <button className="ak-btn" onClick={() => shift(1)} disabled={orderDate >= today} title="다음날"><ChevronRight size={14} /></button>
        {orderDate !== today && <button className="ak-btn ak-btn-primary" onClick={() => go(today)}>오늘</button>}
        <span className="ak-count">업체 {rows.length}곳 · 제출 {doneCount}곳</span>
        <span className="ak-spacer" />
        <Link href="/packing-log/accuracy" className="ak-btn"><BarChart3 size={14} /> 추천 정확도</Link>
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
                  <span className="pk-biz-name">{r.businessName}{r.roundLabel && ` (${r.roundLabel})`}</span>
                  {isModified(r) && <span className="pk-editing" title="수정한 내용이 아직 제출되지 않았습니다">수정 중</span>}
                  {r.orderChanged && <span className="pk-changed" title={r.submitted ? '제출한 뒤 주문이 바뀌었습니다' : '추천을 만든 뒤 주문이 바뀌었습니다'}>주문 변경</span>}
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
                    <div className="pk-title">{selected.businessName}{selected.roundLabel && ` (${selected.roundLabel})`}</div>
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

                {selected.orderChanged && (
                  <div className="pk-rec pk-rec-warn">
                    {selected.submitted ? '제출한 뒤 주문이 바뀌었습니다. 박스 구성을 다시 확인하고 필요하면 고쳐서 다시 제출하세요.' : '추천을 만든 뒤 주문이 바뀌어 추천을 새로 만들었습니다. 박스 구성을 다시 확인하세요.'}
                  </div>
                )}
                <div className="pk-rec">
                  {selected.submitted ? (
                    <>
                      <span className="pk-rec-label">{modified ? '제출한 박스 · 수정 중' : '제출한 박스'}</span>
                      {modified && <button className="ak-btn" onClick={resetToBase}>제출한 내용으로 되돌리기</button>}
                    </>
                  ) : modified ? (
                    <>
                      <span className="pk-rec-label">직접 입력</span>
                      <span className="pk-edited">추천 {rank + 1}순위에서 수정함 · 직접 입력으로 제출됩니다</span>
                      <button className="ak-btn" onClick={resetToBase}>추천대로 되돌리기</button>
                    </>
                  ) : selected.recommendation ? (
                    <>
                      <span className="pk-rec-label">박스 추천</span>
                      <span className={`pk-conf pk-conf-${selected.recommendation.confidence}`}>
                        신뢰도 {CONFIDENCE_LABEL[selected.recommendation.confidence]} {Math.round(selected.recommendation.confidenceScore * 100)}%
                      </span>
                      {selected.recommendation.candidates.map((plan, i) => (
                        <button key={i} className={`pk-tab ${i === rank ? 'pk-tab-on' : ''}`} onClick={() => selectRank(i)}>
                          {i + 1}순위 {planLabel(plan)}
                        </button>
                      ))}
                      <span className="ak-muted pk-rec-hint">다르게 포장했다면 상품을 다른 박스로 끌어다 놓거나 박스를 바꿔주세요.</span>
                    </>
                  ) : (
                    <span className="pk-rec-label">이 업체는 박스 추천이 없습니다. 박스를 추가하고 상품을 끌어다 놓아주세요.</span>
                  )}
                </div>

                {readOnly ? (
                  <div className="pk-view">
                    <div className="pk-slots">
                      {draft.boxes.length === 0 && <p className="pk-hint">담긴 박스가 없습니다.</p>}
                      {draft.boxes.map((box, idx) => (
                        <BoxSlot key={box.uid} box={box} index={idx + 1} items={selected.items} readOnly />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={`pk-board ${unplaced.length === 0 ? 'pk-board-solo' : ''}`}>
                    {unplaced.length > 0 && <Pool items={unplaced} draft={draft} onMoveQty={(id, v) => updateDraft((d) => ({ ...d, moveQty: { ...d.moveQty, [id]: v } }))} onWeight={(id, v) => updateDraft((d) => ({ ...d, weights: { ...d.weights, [id]: v } }))} remainingOf={(i) => remainingOf(draft, i)} total={selected.items.length} />}

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
                          <BoxSlot key={box.uid} box={box} index={idx + 1} items={selected.items} boxTypes={boxes} onChangeType={(boxId) => changeBoxType(box.uid, boxId)} onRemove={() => removeBox(box.uid)} onUnassign={(id) => unassign(id, box.uid)} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pk-foot">
                  {error && <span className="ak-error">{error}</span>}
                  {notice && <span className="ak-notice">{notice}</span>}
                  {!error && !notice && submitHint && <span className="ak-muted">{submitHint}</span>}
                  <span className="ak-spacer" />
                  {!readOnly && (modified || (!selected.submitted && !selected.recommendation)) && (
                    <button className="pk-big" disabled={busy || !canAutoAssign} onClick={handleAutoAssign}>상품 자동으로 다시 나눠 담기</button>
                  )}
                  {selected.submitted && !modified ? (
                    <span className="ak-muted">제출 완료 · 고치려면 상품이나 박스를 바꿔주세요</span>
                  ) : (
                    <button className="pk-big pk-big-primary" disabled={!canSubmit} onClick={handleSubmit}>
                      {busy
                        ? '제출 중...'
                        : selected.submitted
                          ? `수정한 내용으로 다시 제출 (박스 ${draft.boxes.length}개)`
                          : modified || !selected.recommendation
                            ? `이대로 제출할게요 (박스 ${draft.boxes.length}개)`
                            : '맞아요. 제출할게요.'}
                    </button>
                  )}
                </div>

                <LabelPanel key={selected.id} dailyBusinessId={selected.id} boxCount={draft.boxes.length} />
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
        .pk-rec { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.6rem 1.1rem; background: var(--primary-light); border-bottom: 1px solid var(--border); font-size: 0.8125rem; }
        .pk-rec-label { font-weight: 800; color: var(--primary); }
        .pk-rec-warn { background: #fffbeb; color: #92400e; font-weight: 700; }
        .pk-rec-chip { border: 1px solid var(--primary); background: #fff; color: var(--primary); border-radius: 999px; padding: 0.2rem 0.7rem; font-size: 0.8125rem; font-weight: 700; cursor: pointer; }
        .pk-rec-chip:hover { background: var(--primary-light); }
        .pk-rec-hint { font-size: 0.75rem; }
        .pk-conf { border-radius: 999px; padding: 0.15rem 0.6rem; font-size: 0.75rem; font-weight: 800; }
        .pk-conf-high { background: #dcfce7; color: #166534; }
        .pk-conf-medium { background: #fef9c3; color: #854d0e; }
        .pk-conf-low { background: #fee2e2; color: #991b1b; }
        .pk-changed { background: #fef3c7; color: #92400e; border-radius: 999px; padding: 0.1rem 0.5rem; font-size: 0.6875rem; font-weight: 800; white-space: nowrap; }
        .pk-big { min-height: 3.5rem; padding: 0 1.6rem; border-radius: 14px; border: 2px solid var(--border); background: #fff; font-size: 1.25rem; font-weight: 800; cursor: pointer; }
        .pk-big:hover:not(:disabled) { background: #f1f5f9; }
        .pk-big:disabled { opacity: 0.45; cursor: not-allowed; }
        .pk-big-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
        .pk-big-primary:hover:not(:disabled) { background: var(--primary); filter: brightness(1.12); }
        .pk-tab { border: 2px solid var(--border); background: #fff; border-radius: 12px; padding: 0.45rem 0.9rem; font-size: 0.9375rem; font-weight: 700; cursor: pointer; }
        .pk-tab:hover { background: #f1f5f9; }
        .pk-tab-on { border-color: var(--primary); background: var(--primary-light); color: var(--primary); }
        .pk-edited { background: #fef3c7; color: #92400e; border-radius: 999px; padding: 0.15rem 0.7rem; font-size: 0.8125rem; font-weight: 800; }
        .pk-editing { background: #dbeafe; color: #1d4ed8; border-radius: 999px; padding: 0.1rem 0.5rem; font-size: 0.6875rem; font-weight: 800; white-space: nowrap; }
        .pk-view { padding: 1rem 1.1rem; }
        .pk-labels { border-top: 1px solid var(--border); padding: 0.9rem 1.1rem 1.1rem; display: flex; flex-direction: column; gap: 0.7rem; }
        .pk-labels-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.9375rem; }
        .pk-label-boxes { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .pk-label-box { display: flex; align-items: center; gap: 0.5rem; border: 2px solid var(--border); border-radius: 12px; padding: 0.45rem 0.8rem; cursor: pointer; background: #fff; }
        .pk-label-box input { width: 1.1rem; height: 1.1rem; }
        .pk-label-no { font-size: 1.35rem; font-weight: 900; line-height: 1; }
        .pk-label-st { font-size: 0.8125rem; font-weight: 800; color: var(--muted-foreground); }
        .pk-label-new { border-color: #fcd34d; background: #fffbeb; }
        .pk-label-new .pk-label-st { color: #92400e; }
        .pk-label-printed .pk-label-st { color: #1d4ed8; }
        .pk-label-done { background: #f0fdf4; border-color: #86efac; }
        .pk-label-done .pk-label-st { color: #15803d; }
        .pk-label-on { outline: 3px solid var(--primary); outline-offset: 1px; }
        .pk-label-warn { font-size: 0.8125rem; font-weight: 700; color: #92400e; background: #fffbeb; border-radius: 10px; padding: 0.45rem 0.7rem; }
        .pk-label-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
        .pk-label-actions .pk-big { display: inline-flex; align-items: center; gap: 0.5rem; }
        .pk-label-note { font-size: 0.75rem; }
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
        .pk-slot-meta .pk-mulbong { font-size: 0.75rem; padding: 0.05rem 0.5rem; }
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
        .pk-slot-head { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.6rem 0.7rem; background: #f1f5f9; border-radius: 12px 12px 0 0; font-size: 0.8125rem; }
        .pk-slot-row { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
        .pk-slot-no { flex: none; font-size: 1.35rem; font-weight: 900; line-height: 1; white-space: nowrap; color: var(--primary); }
        .pk-slot-select { flex: 1 1 0; min-width: 0; max-width: 100%; text-overflow: ellipsis; }
        .pk-slot-name { flex: 1 1 0; min-width: 0; font-size: 1rem; font-weight: 800; overflow-wrap: anywhere; }
        .pk-slot-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem 0.5rem; }
        .pk-slot-meta > * { white-space: nowrap; }
        .pk-slot-dims { color: var(--muted-foreground); font-size: 0.75rem; }
        .pk-board-solo { grid-template-columns: minmax(0, 1fr); }
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
      {items.length === 0 && <p className="ak-muted" style={{ fontSize: '0.8125rem' }}>모든 상품을 담았어요. 박스에서 빼려면 상품을 여기로 끌어오세요.</p>}
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
  boxTypes = [],
  onChangeType,
  onRemove,
  onUnassign,
  readOnly = false,
}: {
  box: DraftBox;
  index: number;
  items: PackingItem[];
  // 박스 칸 머리에서 박스 종류를 바꿀 수 있다(담긴 상품은 그대로 유지)
  boxTypes?: BoxType[];
  onChangeType?: (boxId: string) => void;
  onRemove?: () => void;
  onUnassign?: (itemId: string) => void;
  // 수정 중이 아닐 때: 끌어다 놓기·빼기 없이 어떤 상품이 담겼는지만 보여준다.
  readOnly?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${box.uid}`, disabled: readOnly });
  const itemById = new Map(items.map((i) => [i.id, i]));
  return (
    <div ref={setNodeRef} className={`pk-slot ${isOver ? 'pk-slot-over' : ''}`}>
      <div className="pk-slot-head">
        <div className="pk-slot-row">
          <strong className="pk-slot-no">{index}번</strong>
          {readOnly || !onChangeType ? (
            <span className="pk-slot-name">{box.name}</span>
          ) : (
            <select className="ak-select pk-slot-select" value={box.boxId ?? ''} onChange={(e) => e.target.value && onChangeType(e.target.value)}>
              {box.boxId === null && <option value="">{box.name} (삭제된 박스)</option>}
              {boxTypes.filter((t) => t.is_active || t.id === box.boxId).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {!readOnly && onRemove && <button className="pk-x" onClick={onRemove} title="박스 빼기 (담은 상품은 다시 왼쪽으로 돌아갑니다)"><X size={16} /></button>}
        </div>
        {(box.isMulbong || box.boxId === null || box.dims) && (
          <div className="pk-slot-meta">
            {box.isMulbong && <span className="pk-mulbong">물봉용</span>}
            {box.boxId === null && <span className="pk-warn">삭제된 박스</span>}
            {box.dims && <span className="pk-slot-dims">{box.dims}cm</span>}
          </div>
        )}
      </div>
      <div className="pk-slot-body">
        {box.items.length === 0 && <span className="pk-slot-empty">여기에 상품을 끌어다 놓으세요</span>}
        {box.items.map((bi) => {
          const item = itemById.get(bi.orderItemId);
          if (!item) return null;
          if (readOnly || !onUnassign) {
            return (
              <div key={bi.orderItemId} className="pk-chip">
                <span className="pk-grip" style={{ cursor: 'default' }}>
                  <span className="pk-name">{item.name}</span>
                  <span className="pk-qty">{fmt(bi.quantity)}{item.unit}{bi.quantity < item.quantity - EPS ? ` / ${fmt(item.quantity)}` : ''}</span>
                  {item.needsMulbong && !box.isMulbong && <span className="pk-warn" title="물봉 포장이 필요한 상품인데 물봉용 박스가 아닙니다">물봉 필요</span>}
                </span>
              </div>
            );
          }
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
