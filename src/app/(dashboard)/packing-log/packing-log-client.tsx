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
import { BarChart3, CircleDashed, ClipboardList, Link2, Package, PackageCheck, Printer, PrinterCheck, PrinterX, Trash2, X } from 'lucide-react';
import type { StoredPlan } from '@/lib/packing/server';
import type { PackingBoxType as BoxType, PackingBusiness, PackingItem } from '@/lib/packing/types';
import { summarizeBoxNeeds } from '@/lib/packing/box-needs';
import { emptyBoxMessage, firstEmptyBoxIndex, removalShiftsPrintedLabels } from '@/lib/packing/box-rules';
import { EXCLUDED_REASON_LABEL } from '@/lib/packing/excluded-items';
import { submitPacking, assignItemsToBoxes, deletePackingRecord } from './actions';
import { prepareBatchLabelPrint } from '../labels/actions';
import { LabelPrinter, type LabelPrintJob } from '@/components/labels/label-printer';
import { mergeKey, mergeUids, pruneUidGroups, seqGroupsFromUid, uidGroupsFromSeq, unmergeUids, type UidGroups } from '@/lib/packing/merge-draft';
import { LabelPanel } from './label-panel';
import { useCan } from '@/components/permissions-context';
import { DateNav } from '@/components/date-nav';

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
  // 합포장 묶음(박스의 화면 식별자 묶음). 박스를 지우거나 순서가 바뀌어도 따라가고, 제출할 때 현재 박스 순서의 번호 묶음으로 바꾼다.
  mergeUids: UidGroups;
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
// 상품(또는 그 일부 수량)을 박스에 담는다. fromUid가 있으면 그 박스에서는 뺀다. 같은 상품이 이미 있으면 수량을 합친다.
function applyAssign(d: Draft, itemId: string, toUid: string, qty: number, fromUid?: string): Draft {
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
}
// 지금 눌러 둔 상품: 아직 담지 않은 상품(fromUid 없음)이거나 박스에 담긴 상품(그 박스의 uid).
interface Picked {
  itemId: string;
  fromUid: string | null;
}
let uidCounter = 0;
const newUid = () => `box-${Date.now()}-${uidCounter++}`;

export function PackingLogClient({
  orderDate,
  today,
  allowPast,
  rows: allRows,
  boxes,
  embedded = false,
  onSubmitted,
}: {
  orderDate: string;
  today: string;
  allowPast: boolean;
  rows: PackingBusiness[];
  boxes: BoxType[];
  // 주문 목록의 박스 할당 팝업 안에서 쓸 때: 업체 목록·제목 줄·필요 박스 줄 없이 업체 한 곳(rows[0])의 편집 영역만 보이고, 제출하면 onSubmitted를 부른다.
  embedded?: boolean;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  // 주문 상품이 모두 취소된 고객사는 박스 할당·라벨 출력이 필요 없어 목록에서 뺀다(업체 수·제출 수·필요 박스에도 세지 않는다).
  const rows = useMemo(() => (embedded ? allRows : allRows.filter((r) => !r.cancelled)), [allRows, embedded]);
  // 과거 날짜는 설정에서 "과거 날짜 편집"을 켰을 때만 제출·삭제할 수 있다(서버도 같은 규칙으로 막는다).
  // 제출 권한이 없는 계정은 조회 전용이다. 기록 삭제·라벨 출력은 각각 별도 권한이다.
  const can = useCan();
  const readOnly = (orderDate !== today && !allowPast) || !can('packing:submit');
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [onlyPending, setOnlyPending] = useState(false);
  // 업체를 오가도 작성 중인 내용이 사라지지 않게 업체별로 보관한다(제출 전까지는 이 화면 메모리에만 있다).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeDrag, setActiveDrag] = useState<{ label: string; qty: number; unit: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null); // 눌러 둔 상품(옮길 박스를 고르는 중)
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
      // 제출한 뒤 주문에서 취소·삭제된 상품은 박스에서 뺀다(남겨 두면 "주문에 없는 상품이 포함돼 있습니다"로 재제출이 막힌다).
      const liveIds = new Set(row.items.map((i) => i.id));
      return row.submitted.boxes.map((b, index) => {
        const type = b.boxId ? boxTypeById.get(b.boxId) : undefined;
        return {
          uid: `saved-${row.id}-${index}`,
          boxId: type ? type.id : null,
          name: b.boxName,
          dims: type ? dimsOf(type) : null,
          isMulbong: type?.is_mulbong_box ?? false,
          items: b.items.filter((i) => liveIds.has(i.orderItemId)),
        };
      });
    }
    const plan = row.recommendation?.candidates[rank];
    return plan ? boxesFromPlan(row, plan, rank) : [];
  };
  // 항상 수정할 수 있다: 화면의 박스·상품이 곧 작성본이다. 건드리기 전에는 추천(또는 제출한 기록) 그대로이고,
  // 건드리면 그때부터 업체별로 보관한다(제출·되돌리기 전까지는 이 화면 메모리에만 있다).
  const makeDraft = (row: PackingBusiness, rank: number): Draft => {
    const boxes = baseBoxes(row, rank);
    return {
    boxes,
    mergeUids: uidGroupsFromSeq(boxes.map((b) => b.uid), row.mergeGroups),
    moveQty: {},
    weights: Object.fromEntries(row.items.filter((i) => i.weightKg != null).map((i) => [i.id, String(i.weightKg)])),
    source: 'base',
    baseRank: rank,
    };
  };
  // 합포장을 처음 불러온 상태(제출한 기록의 묶음)와 비교하는 키. 박스를 건드리지 않고 묶음만 바꿔도 "수정함"이다.
  const baseMergeKey = (row: PackingBusiness, rank: number) => {
    const uids = baseBoxes(row, rank).map((b) => b.uid);
    return mergeKey(uids, uidGroupsFromSeq(uids, row.mergeGroups));
  };
  const draftMergeKey = (d: Draft) => mergeKey(d.boxes.map((b) => b.uid), d.mergeUids);
  const isModified = (row: PackingBusiness) => {
    const d = drafts[row.id];
    return !!d && (layoutKey(d.boxes) !== layoutKey(baseBoxes(row, d.baseRank)) || draftMergeKey(d) !== baseMergeKey(row, d.baseRank));
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
  // 빈 박스는 제출할 수 없다(서버도 막는다). 예전에 제출해 둔 빈 박스도 여기서 걸러져 다시 제출할 때 지우게 된다.
  const emptyBoxAt = draft ? firstEmptyBoxIndex(draft.boxes) : -1;
  const canSubmit = !readOnly && !!draft && draft.boxes.length > 0 && unplaced.length === 0 && !hasDeletedBox && emptyBoxAt < 0 && !busy && (selected?.items.length ?? 0) > 0 && (!selected?.submitted || modified);
  const submitHint = !draft
    ? ''
    : readOnly
      ? '과거 날짜는 설정에서 "과거 날짜 편집"을 켜면 제출할 수 있습니다'
      : draft.boxes.length === 0
      ? '박스를 추가해주세요'
      : hasDeletedBox
        ? '삭제된 박스가 있습니다. 해당 박스를 지우고 다른 박스를 추가해주세요'
        : unplaced.length > 0
          ? `아직 담지 않은 상품 ${unplaced.length}개`
          : emptyBoxAt >= 0
            ? emptyBoxMessage(emptyBoxAt)
            : '';

  // ─── 담기/옮기기/빼기 ─────────────────────────────────────────────────────
  const assign = (itemId: string, toUid: string, qty: number, fromUid?: string) => updateDraft((d) => applyAssign(d, itemId, toUid, qty, fromUid));
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
  // 눌러 둔 상품을 새 박스(고른 종류)에 담는다.
  const moveToNewBox = (itemId: string, type: BoxType, qty: number, fromUid?: string) =>
    updateDraft((d) => {
      const box: DraftBox = { uid: newUid(), boxId: type.id, name: type.name, dims: dimsOf(type), isMulbong: type.is_mulbong_box, items: [] };
      return applyAssign({ ...d, boxes: [...d.boxes, box] }, itemId, box.uid, qty, fromUid);
    });
  const removeBox = (uid: string) => {
    if (draft && selected) {
      const at = draft.boxes.findIndex((b) => b.uid === uid);
      const shifts = removalShiftsPrintedLabels(selected.submitted?.boxes.length ?? 0, at, selected.labelStatus?.printed ?? 0);
      if (shifts && !window.confirm('이미 라벨을 출력한 업체입니다. 가운데 박스를 지우면 뒤 박스의 번호가 앞당겨져 붙여 둔 스티커와 어긋납니다. 그래도 지울까요?')) return;
      // 담은 상품이 있는 박스는 손가락이 스치기만 해도 지워지지 않게 한 번 묻는다(상품은 지워지지 않고 상품 목록으로 돌아간다). 빈 박스는 바로 지운다.
      const filled = draft.boxes[at]?.items.length ?? 0;
      if (!shifts && filled > 0 && !window.confirm(`${at + 1}번 박스를 뺄까요? 담은 상품 ${filled}개는 상품 목록으로 돌아갑니다.`)) return;
    }
    updateDraft((d) => {
      const boxesNext = d.boxes.filter((b) => b.uid !== uid);
      return { ...d, boxes: boxesNext, mergeUids: pruneUidGroups(d.mergeUids, boxesNext.map((b) => b.uid)) };
    });
  };
  const changeMerge = (next: UidGroups) => updateDraft((d) => ({ ...d, mergeUids: next }));

  const parseMove = (d: Draft, item: PackingItem) => {
    const remaining = remainingOf(d, item);
    const typed = parseFloat(d.moveQty[item.id] ?? '');
    return Number.isFinite(typed) && typed > 0 ? Math.min(typed, remaining) : remaining;
  };

  // 눌러 둔 상품이 아직 그 자리에 있을 때만 유효하다(옮기거나 업체를 바꾸면 자동으로 풀린다).
  const pickedItem = picked && selected ? selected.items.find((i) => i.id === picked.itemId) ?? null : null;
  const pickedValid =
    !!pickedItem &&
    !!draft &&
    (picked!.fromUid === null
      ? remainingOf(draft, pickedItem) > EPS
      : !!draft.boxes.find((b) => b.uid === picked!.fromUid)?.items.some((i) => i.orderItemId === pickedItem.id));
  const activePick = pickedValid ? picked : null;
  const togglePick = (itemId: string, fromUid: string | null) => setPicked((cur) => (cur && cur.itemId === itemId && cur.fromUid === fromUid ? null : { itemId, fromUid }));
  const pickedQty = (): number => {
    if (!activePick || !pickedItem || !draft) return 0;
    return activePick.fromUid
      ? draft.boxes.find((b) => b.uid === activePick.fromUid)?.items.find((i) => i.orderItemId === pickedItem.id)?.quantity ?? 0
      : parseMove(draft, pickedItem);
  };
  const movePickedTo = (toUid: string) => {
    if (!activePick || !pickedItem || activePick.fromUid === toUid) return;
    const qty = pickedQty();
    if (qty > EPS) assign(pickedItem.id, toUid, qty, activePick.fromUid ?? undefined);
    setPicked(null);
  };
  const movePickedToNewBox = (typeId: string) => {
    const type = boxTypeById.get(typeId);
    if (!activePick || !pickedItem || !type) return;
    const qty = pickedQty();
    if (qty > EPS) moveToNewBox(pickedItem.id, type, qty, activePick.fromUid ?? undefined);
    setPicked(null);
  };
  const removePicked = () => {
    if (activePick?.fromUid && pickedItem) unassign(pickedItem.id, activePick.fromUid);
    setPicked(null);
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
      // 합포장은 이 화면에서 바꿨을 때만 보낸다(라벨 영역에서 따로 바꾼 묶음을 덮어쓰지 않으려고).
      mergeGroups: draftMergeKey(draft) !== baseMergeKey(selected, draft.baseRank) ? seqGroupsFromUid(draft.boxes.map((b) => b.uid), draft.mergeUids) : undefined,
    });
    setBusy(false);
    if (result.error) return setError(result.error);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[selected.id]; // 제출한 내용으로 다시 불러오게 한다
      return next;
    });
    if (embedded) {
      onSubmitted?.(); // 팝업: 다음 업체 없이 닫는다(주문 목록은 서버 액션이 새 화면을 보내 갱신된다)
      return;
    }
    // 다음 미제출 업체로 바로 넘어간다(목록에서 현재 업체 뒤쪽을 먼저, 없으면 처음부터). 없으면 그 업체에 머문다.
    const at = rows.findIndex((r) => r.id === selected.id);
    const next = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))].find((r) => !r.submitted && r.id !== selected.id);
    if (next) {
      setSelectedId(next.id);
      setConfirmDelete(false);
    }
    setPicked(null);
    setNotice(`${selected.businessName}${selected.roundLabel ? ` (${selected.roundLabel})` : ''} 박스 할당을 제출했습니다.${next ? '' : ' 남은 업체가 없습니다.'}`);
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

  // 오늘 필요한 박스(종류별 개수): 제출한 업체는 제출한 구성, 미제출 업체는 지금 화면의 구성(작성 중이면 그것, 아니면 보고 있는 추천)으로 센다.
  const needs = summarizeBoxNeeds(
    rows.map((r) => ({
      submittedNames: r.submitted ? r.submitted.boxes.map((b) => b.boxName) : null,
      plannedNames: r.submitted ? [] : (drafts[r.id]?.boxes ?? baseBoxes(r, rankOf(r))).map((b) => b.name),
    })),
    boxes.map((b) => b.name),
  );

  // 라벨 일괄 출력: 제출한 업체(택배 제외) 중 아직 한 번도 출력하지 않은 라벨을 업체 번호순으로 한 번에 낸다. 대상 수는 목록의 출력 현황으로 센다.
  const [batchJob, setBatchJob] = useState<LabelPrintJob | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchTargets = rows.filter((r) => r.submitted && !r.parcel && r.labelStatus && r.labelStatus.total > r.labelStatus.printed);
  const batchLabels = batchTargets.reduce((sum, r) => sum + (r.labelStatus ? r.labelStatus.total - r.labelStatus.printed : 0), 0);
  const unsubmittedCount = rows.filter((r) => !r.submitted && !r.parcel).length;
  const handleBatchPrint = async () => {
    if (batchBusy || batchLabels === 0) return;
    const warn = unsubmittedCount > 0 ? `\n\n아직 박스를 제출하지 않은 업체 ${unsubmittedCount}곳은 제외됩니다.` : '';
    if (!window.confirm(`아직 출력하지 않은 라벨 ${batchLabels}장(${batchTargets.length}곳)을 업체 번호순으로 한꺼번에 출력합니다.${warn}\n\n인쇄 창을 닫거나 취소해도 "출력함"으로 기록됩니다. 계속할까요?`)) return;
    setBatchBusy(true);
    setError(null);
    const payload = await prepareBatchLabelPrint(orderDate);
    setBatchBusy(false);
    if (payload.error || !payload.template) return setError(payload.error ?? '라벨을 준비하지 못했습니다.');
    if (payload.skipped.length > 0) setError(`일부 업체의 라벨은 준비하지 못했습니다: ${payload.skipped.join(' / ')}`);
    else setNotice(`${payload.businesses}곳 · 라벨 ${payload.labels.length}장을 출력합니다.`);
    setBatchJob({ template: payload.template, labels: payload.labels, rotate: payload.rotated });
  };

  const go = (date: string) => router.push(`/packing-log?date=${date}`);

  const visibleRows = onlyPending ? rows.filter((r) => !r.submitted) : rows;
  const doneCount = rows.filter((r) => r.submitted).length;

  return (
    <div className="pk-root">
      {/* PC에서는 제목 줄과 날짜·필터 줄을 한 줄로 합쳐 작업 영역이 위로 올라오게 한다(휴대폰은 제목 줄이 숨겨지고 도구줄만 남는다). */}
      {!embedded && (
      <div className="pk-top">
        <div className="page-header">
          <div className="page-header-icon"><ClipboardList size={20} /></div>
          <div>
            <h1 className="page-title">박스 할당 / 라벨 출력</h1>
            <p className="page-sub">추천 박스를 확인해 제출하고, 제출한 박스의 라벨을 출력합니다. 제출한 기록은 추천의 정확도 측정과 학습에 쓰입니다.</p>
          </div>
        </div>

        <div className="ak-toolbar">
          <DateNav value={orderDate} today={today} onChange={go} label="박스 할당 날짜" />
          <span className="ak-count">업체 {rows.length}곳 · 제출 {doneCount}곳</span>
          <span className="ak-spacer" />
          {can('packing:print') && (
            <button type="button" className="ak-btn ak-btn-primary" disabled={batchBusy || batchLabels === 0} onClick={handleBatchPrint} title={batchLabels === 0 ? '출력할 라벨이 없습니다(제출한 업체의 라벨을 모두 출력했습니다)' : '아직 출력하지 않은 라벨을 업체 번호순으로 한꺼번에 출력합니다'}>
              <Printer size={14} /> {batchBusy ? '준비 중…' : `라벨 일괄 출력${batchLabels > 0 ? ` (${batchTargets.length}곳 · ${batchLabels}장)` : ''}`}
            </button>
          )}
          {can('reports:view') && <Link href="/reports/box?view=accuracy" className="ak-btn"><BarChart3 size={14} /> 추천 정확도</Link>}
          <label className="pk-check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> 미기록 업체만</label>
        </div>
      </div>
      )}

      {!embedded && rows.length > 0 && (
        <div className="pk-needs" aria-label="오늘 필요한 박스">
          <span className="pk-needs-title"><Package size={15} aria-hidden /> 오늘 필요한 박스</span>
          {needs.lines.length === 0 && <span className="ak-muted">아직 박스가 정해진 업체가 없습니다.</span>}
          {needs.lines.map((l) => (
            <span key={l.name} className="pk-need" title={`${l.name}: 제출 ${l.submitted}개${l.planned > 0 ? ` + 미제출 업체 예상 ${l.planned}개` : ''}`}>
              {l.name} <b>{l.submitted + l.planned}</b>
              {l.planned > 0 && <em>{l.submitted > 0 ? `제출 ${l.submitted}` : '예상'}</em>}
            </span>
          ))}
          <span className="ak-spacer" />
          <span className="pk-needs-sum">합계 <b>{needs.submittedTotal + needs.plannedTotal}</b>개{needs.plannedTotal > 0 && <> (제출 {needs.submittedTotal} + 예상 {needs.plannedTotal})</>} · {needs.rows}곳 중 {needs.submittedRows}곳 제출</span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="ak-empty">이 날짜에 주문이 없습니다.</p>
      ) : (
        <div className={`pk-layout ${embedded ? 'pk-layout-single' : ''}`}>
          {!embedded && (
          <aside className="pk-list">
            {visibleRows.length === 0 && <p className="ak-empty" style={{ padding: '1.5rem 0.5rem' }}>모두 제출했습니다.</p>}
            {visibleRows.map((r) => (
              <button key={r.id} className={`pk-biz ${r.id === selectedId ? 'pk-biz-on' : ''} ${r.submitted && r.id !== selectedId ? 'pk-biz-done' : ''}`} onClick={() => { setSelectedId(r.id); setError(null); setNotice(null); setConfirmDelete(false); setPicked(null); }}>
                <span className="pk-biz-top">
                  <span className="pk-biz-name">{r.businessName}{r.roundLabel && ` (${r.roundLabel})`}</span>
                  {isModified(r) && <span className="pk-editing" title="수정한 내용이 아직 제출되지 않았습니다">수정 중</span>}
                  {r.orderChanged && <span className="pk-changed" title={r.submitted ? '제출한 뒤 주문이 바뀌었습니다' : '추천을 만든 뒤 주문이 바뀌었습니다'}>주문 변경</span>}
                  <span className="pk-chips">
                  {r.submitted ? (
                    <span className="ak-tag ak-tag-on pk-ico" title={`제출 · 박스 ${r.submitted.boxes.length}개`} aria-label={`제출, 박스 ${r.submitted.boxes.length}개`}><PackageCheck size={14} aria-hidden />{r.submitted.boxes.length}</span>
                  ) : (
                    <span className="ak-tag ak-tag-off pk-ico" title="미기록" aria-label="미기록"><CircleDashed size={14} aria-hidden /></span>
                  )}
                  {r.labelStatus && r.labelStatus.total > 0 && (
                    r.labelStatus.printed === 0
                      ? <span className="ak-tag ak-tag-off pk-ico" title="라벨 미출력" aria-label="라벨 미출력"><PrinterX size={14} aria-hidden /></span>
                      : r.labelStatus.printed < r.labelStatus.total
                        ? <span className="ak-tag pk-label-part pk-ico" title={`라벨 ${r.labelStatus.printed}/${r.labelStatus.total} 출력 (아직 출력하지 않은 박스가 있습니다)`} aria-label={`라벨 ${r.labelStatus.total}개 중 ${r.labelStatus.printed}개 출력`}><Printer size={14} aria-hidden />{r.labelStatus.printed}/{r.labelStatus.total}</span>
                        : <span className="ak-tag ak-tag-on pk-ico" title={`라벨 ${r.labelStatus.total}/${r.labelStatus.total} 모두 출력`} aria-label={`라벨 ${r.labelStatus.total}개 모두 출력`}><PrinterCheck size={14} aria-hidden />{r.labelStatus.printed}/{r.labelStatus.total}</span>
                  )}
                  </span>
                </span>
                <span className="pk-biz-sub">{r.terminal || '터미널 없음'} · 상품 {r.items.length}개</span>
              </button>
            ))}
          </aside>
          )}

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
                      can('packing:delete') && <button className="ak-btn ak-btn-danger" disabled={readOnly} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 기록 삭제</button>
                    )
                  )}
                </div>

                {selected.orderChanged && (
                  <div className="pk-rec pk-rec-warn">
                    {selected.submitted ? '제출한 뒤 주문이 바뀌었습니다. 박스 구성을 다시 확인하고 필요하면 고쳐서 다시 제출하세요.' : '추천을 만든 뒤 주문이 바뀌어 추천을 새로 만들었습니다. 박스 구성을 다시 확인하세요.'}
                  </div>
                )}
                {selected.excludedItems.length > 0 && (
                  <div className="pk-rec pk-rec-warn">
                    박스에 담을 수 없는 상품 {selected.excludedItems.length}개가 목록에서 빠져 있습니다:{' '}
                    {selected.excludedItems.map((e) => `${e.name}(${EXCLUDED_REASON_LABEL[e.reason]})`).join(', ')}. 박스에 담아야 하면 주문 목록에서 수량이나 미출고를 먼저 고쳐 주세요.
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
                      <span className="pk-edited">{selected.recommendation ? `추천 ${rank + 1}순위에서 수정함 · ` : ''}직접 입력으로 제출됩니다</span>
                      <button className="ak-btn" onClick={resetToBase}>{selected.recommendation ? '추천대로 되돌리기' : '처음으로 되돌리기'}</button>
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
                      <span className="ak-muted pk-rec-hint">다르게 포장했다면 상품을 눌러 다른 박스로 옮기거나 박스를 바꿔주세요.</span>
                    </>
                  ) : (
                    <span className="pk-rec-label">이 업체는 박스 추천이 없습니다. 박스를 추가하고 상품을 눌러 담아주세요.</span>
                  )}
                </div>

                {readOnly ? (
                  <div className="pk-view">
                    <div className="pk-rows">
                      {draft.boxes.length === 0 && <p className="pk-hint">담긴 박스가 없습니다.</p>}
                      {draft.boxes.map((box, idx) => (
                        <BoxRow key={box.uid} box={box} index={idx + 1} items={selected.items} readOnly />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pk-board">
                    {unplaced.length > 0 && (
                      <Pool items={unplaced} remainingOf={(i) => remainingOf(draft, i)} total={selected.items.length} picked={activePick} onPick={(id) => togglePick(id, null)} />
                    )}
                    <MoveBar
                      item={pickedItem && activePick ? pickedItem : null}
                      fromUid={activePick?.fromUid ?? null}
                      boxes={draft.boxes}
                      boxTypes={activeBoxes}
                      remaining={pickedItem && activePick && !activePick.fromUid ? remainingOf(draft, pickedItem) : 0}
                      moveQty={pickedItem ? draft.moveQty[pickedItem.id] ?? '' : ''}
                      weight={pickedItem ? draft.weights[pickedItem.id] ?? '' : ''}
                      onMoveQty={(v) => pickedItem && updateDraft((d) => ({ ...d, moveQty: { ...d.moveQty, [pickedItem.id]: v } }))}
                      onWeight={(v) => pickedItem && updateDraft((d) => ({ ...d, weights: { ...d.weights, [pickedItem.id]: v } }))}
                      onMoveTo={movePickedTo}
                      onNewBox={movePickedToNewBox}
                      onRemove={removePicked}
                      onClose={() => setPicked(null)}
                    />
                    <div className="pk-rows">
                      {draft.boxes.length === 0 && <p className="pk-hint">아래에서 박스를 추가한 뒤, 상품을 눌러 박스에 담으세요.</p>}
                      {draft.boxes.map((box, idx) => (
                        <BoxRow key={box.uid} box={box} index={idx + 1} items={selected.items} boxTypes={boxes} picked={activePick} onPick={(id) => togglePick(id, box.uid)} onChangeType={(boxId) => changeBoxType(box.uid, boxId)} onRemove={() => removeBox(box.uid)} />
                      ))}
                    </div>
                    {draft.boxes.length >= 2 && <MergeBar boxes={draft.boxes} groups={draft.mergeUids} onChange={changeMerge} />}
                    <div className="pk-addrow">
                      <label className="pk-add">
                        <Package size={14} aria-hidden />
                        <select className="ak-select" value="" aria-label="박스 추가" onChange={(e) => { const t = boxTypeById.get(e.target.value); if (t) addBox(t); }}>
                          <option value="">+ 박스 추가…</option>
                          {activeBoxes.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_mulbong_box ? ' (물봉)' : ''}{dimsOf(b) ? ` · ${dimsOf(b)}cm` : ''}</option>)}
                        </select>
                      </label>
                      {activeBoxes.length === 0 && <span className="ak-muted">사용 중인 박스가 없습니다 (박스 관리)</span>}
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
                            ? `이대로 제출하고 다음 업체 (박스 ${draft.boxes.length}개)`
                            : '맞아요. 제출하고 다음 업체'}
                    </button>
                  )}
                </div>

                {can('packing:print') && !selected.parcel && <LabelPanel key={selected.id} dailyBusinessId={selected.id} boxCount={selected.submitted?.boxes.length ?? 0} boxTypes={selected.submitted?.boxes.map((b) => b.boxName) ?? []} />}
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

      <LabelPrinter job={batchJob} onDone={() => setBatchJob(null)} />

      <style>{`
        .pk-root { display: flex; flex-direction: column; gap: var(--space-block); min-width: 0; }
        .pk-rec { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.6rem 1.1rem; background: var(--primary-light); border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
        .pk-rec-label { font-weight: 800; color: var(--primary); }
        .pk-rec-warn { background: #fffbeb; color: #92400e; font-weight: 700; }
        .pk-rec-chip { border: 1px solid var(--primary); background: #fff; color: var(--primary); border-radius: 999px; padding: 0.2rem 0.7rem; font-size: var(--fs-sm); font-weight: 700; cursor: pointer; }
        .pk-rec-chip:hover { background: var(--primary-light); }
        .pk-rec-hint { font-size: var(--fs-xs); }
        .pk-conf { border-radius: 999px; padding: 0.15rem 0.6rem; font-size: var(--fs-xs); font-weight: 800; }
        .pk-conf-high { background: #dcfce7; color: #166534; }
        .pk-conf-medium { background: #fef9c3; color: #854d0e; }
        .pk-conf-low { background: #fee2e2; color: #991b1b; }
        .pk-changed { background: #fef3c7; color: #92400e; border-radius: 999px; padding: 0.1rem 0.5rem; font-size: var(--fs-xs); font-weight: 800; white-space: nowrap; }
        .pk-big { min-height: 3.5rem; padding: 0 1.6rem; border-radius: 14px; border: 2px solid var(--border); background: #fff; font-size: var(--fs-xl); font-weight: 800; cursor: pointer; }
        .pk-big:hover:not(:disabled) { background: #f1f5f9; }
        .pk-big:disabled { opacity: 0.45; cursor: not-allowed; }
        .pk-big-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
        .pk-big-primary:hover:not(:disabled) { background: var(--primary); filter: brightness(1.12); }
        .pk-tab { border: 2px solid var(--border); background: #fff; border-radius: 12px; padding: 0.45rem 0.9rem; font-size: var(--fs-md); font-weight: 700; cursor: pointer; }
        .pk-tab:hover { background: #f1f5f9; }
        .pk-tab-on { border-color: var(--primary); background: var(--primary-light); color: var(--primary); }
        .pk-edited { background: #fef3c7; color: #92400e; border-radius: 999px; padding: 0.15rem 0.7rem; font-size: var(--fs-sm); font-weight: 800; }
        .pk-editing { background: #dbeafe; color: #1d4ed8; border-radius: 999px; padding: 0.1rem 0.5rem; font-size: var(--fs-xs); font-weight: 800; white-space: nowrap; }
        .pk-view { padding: 1rem 1.1rem; }
        .pk-check { display: flex; align-items: center; gap: 0.4rem; font-size: var(--fs-sm); font-weight: 600; color: var(--muted-foreground); cursor: pointer; }
        .pk-layout { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 0.9rem; align-items: start; }
        .pk-list { display: flex; flex-direction: column; gap: 0.4rem; max-height: calc(100vh - 14rem); overflow-y: auto; }
        .pk-biz { text-align: left; background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 0.6rem 0.8rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.2rem; }
        .pk-biz:hover { background: #f8fafc; }
        .pk-biz-on { border-color: var(--primary); background: var(--primary-light); }
        .pk-biz-top { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; }
        .pk-biz-name { font-weight: 700; font-size: var(--fs-md); min-width: 0; overflow-wrap: anywhere; }
        .pk-chips { display: inline-flex; align-items: center; gap: 0.3rem; flex: none; }
        .pk-ico { display: inline-flex; align-items: center; gap: 0.2rem; }
        .pk-label-part { background: #fffbeb; border-color: #fcd34d; color: #b45309; }
        .pk-biz .ak-tag, .pk-biz .pk-changed, .pk-biz .pk-editing { white-space: nowrap; flex: none; }
        .pk-biz-sub { font-size: var(--fs-xs); color: var(--muted-foreground); }
        .pk-work { container-type: inline-size; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; min-width: 0; }
        .pk-work-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.85rem 1.1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
        .pk-title { font-size: var(--fs-lg); font-weight: 800; color: var(--primary); }
        .pk-aerator { font-size: var(--fs-xs); font-weight: 800; color: #0f766e; background: #f0fdfa; border: 1px solid #5eead4; border-radius: 999px; padding: 0 0.35rem; }
        .pk-mulbong { font-size: var(--fs-xs); font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 999px; padding: 0 0.35rem; }
        .pk-x { border: none; background: transparent; color: var(--muted-foreground); cursor: pointer; padding: 0.15rem; border-radius: 6px; display: inline-flex; }
        .pk-x:hover { background: #e2e8f0; color: var(--danger); }
        .pk-warn { font-size: var(--fs-xs); font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 999px; padding: 0 0.35rem; }
        .pk-foot { display: flex; align-items: center; gap: 0.75rem; padding: 0.85rem 1.1rem; border-top: 1px solid var(--border); flex-wrap: wrap; }
        .pk-submit { height: 2.5rem; padding: 0 1.4rem; font-size: var(--fs-md); }
        /* 박스 할당 보드(2026-11-14 개편): 박스를 한 줄씩 나열해 박스가 7개여도 한 화면에 들어오게 하고, 상품은 눌러서 박스 번호 한 번으로 옮긴다. */
        .pk-needs { display: flex; align-items: center; gap: 0.4rem 0.6rem; flex-wrap: wrap; padding: 0.45rem 0.9rem; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); font-size: var(--fs-sm); }
        .pk-needs-title { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 800; color: var(--primary); }
        .pk-need { display: inline-flex; align-items: baseline; gap: 0.3rem; border: 1px solid var(--border); background: var(--primary-light); border-radius: 999px; padding: 0.1rem 0.65rem; font-weight: 700; white-space: nowrap; }
        .pk-need b { font-size: var(--fs-md); font-weight: 900; color: var(--primary); }
        .pk-need em { font-style: normal; font-size: var(--fs-xs); color: var(--muted-foreground); }
        .pk-needs-sum { color: var(--muted-foreground); font-weight: 600; white-space: nowrap; }
        .pk-needs-sum b { color: var(--foreground); font-weight: 900; }
        .pk-biz-done { opacity: 0.6; }
        .pk-layout-single { grid-template-columns: minmax(0, 1fr); }
        .pk-merge { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; padding: 0.3rem 0.6rem; border: 1px dashed #cbd5e1; border-radius: 12px; font-size: var(--fs-sm); }
        .pk-merge-title { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 800; color: var(--primary); }
        .pk-merge-group { display: inline-flex; align-items: center; gap: 0.2rem; background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; border-radius: 999px; padding: 0.05rem 0.2rem 0.05rem 0.6rem; font-weight: 800; }
        .pk-merge-pick { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: auto; }
        .pk-to-on { background: var(--primary); color: #fff; }
        .pk-to-merge { border-color: #059669; color: #047857; }
        .pk-to-merge:hover:not(:disabled) { background: #059669; color: #fff; }
        .pk-board { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.65rem 1rem; }
        .pk-pool { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; background: #f8fafc; border: 2px dashed #e2e8f0; border-radius: 12px; padding: 0.4rem 0.6rem; }
        .pk-pool-over { border-color: var(--primary); background: var(--primary-light); }
        .pk-pool-title { font-size: var(--fs-xs); font-weight: 800; color: var(--muted-foreground); margin-right: 0.2rem; }
        .pk-move { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; min-height: 2.6rem; padding: 0.3rem 0.6rem; border: 1px solid var(--primary); background: var(--primary-light); border-radius: 12px; font-size: var(--fs-sm); }
        .pk-move-idle { border-style: dashed; border-color: var(--border); background: transparent; color: var(--muted-foreground); }
        .pk-move-what { font-size: var(--fs-md); font-weight: 800; color: var(--primary); }
        .pk-move-label { font-weight: 700; color: var(--muted-foreground); margin-left: 0.2rem; }
        .pk-to { min-width: 2.2rem; height: 2rem; padding: 0 0.5rem; border-radius: 10px; border: 1px solid var(--primary); background: #fff; color: var(--primary); font-weight: 900; font-size: var(--fs-md); cursor: pointer; }
        .pk-to:hover:not(:disabled) { background: var(--primary); color: #fff; }
        .pk-to:disabled { opacity: 0.35; cursor: not-allowed; }
        .pk-to-out { border-color: #cbd5e1; color: #475569; font-size: var(--fs-sm); }
        .pk-to-new { height: 2rem; max-width: 9rem; }
        .pk-move-opt { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--muted-foreground); font-weight: 600; margin-left: 0.4rem; }
        .pk-mini { width: 3.6rem; height: 1.8rem; border: 1px solid var(--border); border-radius: 8px; text-align: center; font-size: var(--fs-xs); background: #fff; }
        .pk-move .pk-x { margin-left: auto; }
        .pk-rows { display: flex; flex-direction: column; gap: 0.35rem; max-height: 36rem; overflow-y: auto; padding: 0.1rem; }
        .pk-row { display: grid; grid-template-columns: 2.8rem 13.5rem minmax(0, 1fr) auto; align-items: center; gap: 0.5rem; border: 2px solid #cbd5e1; border-radius: 12px; background: #fff; padding: 0.2rem 0.5rem; }
        .pk-row-over { border-color: var(--primary); background: var(--primary-light); }
        .pk-row-no { font-size: var(--fs-lg); font-weight: 900; color: var(--primary); white-space: nowrap; }
        .pk-row-type { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
        .pk-row-meta { display: inline-flex; align-items: center; gap: 0.3rem; flex: none; }
        .pk-row-meta:empty { display: none; }
        .pk-slot-select { flex: 1 1 0; width: auto; min-width: 0; text-overflow: ellipsis; }
        .pk-slot-name { font-size: var(--fs-md); font-weight: 800; overflow-wrap: anywhere; }
        .pk-slot-dims { color: var(--muted-foreground); font-size: var(--fs-xs); white-space: nowrap; }
        .pk-slot-empty { color: #94a3b8; font-size: var(--fs-sm); }
        .pk-row-chips { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; min-height: 2rem; min-width: 0; }
        .pk-chip { display: inline-flex; align-items: center; gap: 0.35rem; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0.25rem 0.55rem; font-size: var(--fs-sm); cursor: pointer; touch-action: none; user-select: none; font-family: inherit; }
        .pk-chip:hover { border-color: var(--primary); }
        .pk-chip-sel { border: 2px solid var(--primary); background: var(--primary-light); padding: calc(0.25rem - 1px) calc(0.55rem - 1px); }
        .pk-chip-static { cursor: default; }
        .pk-chip-static:hover { border-color: #cbd5e1; }
        .pk-chip-ghost { box-shadow: var(--shadow-md); border-color: var(--primary); padding: 0.45rem 0.8rem; }
        .pk-name { font-weight: 700; word-break: keep-all; }
        .pk-qty { color: var(--muted-foreground); white-space: nowrap; }
        .pk-size { color: #0369a1; font-size: var(--fs-xs); white-space: nowrap; }
        .pk-hint { color: var(--muted-foreground); font-size: var(--fs-md); padding: 1.2rem 0; text-align: center; border: 2px dashed #e2e8f0; border-radius: 12px; }
        .pk-addrow { display: flex; align-items: center; gap: 0.5rem; }
        .pk-add { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--muted-foreground); }
        .pk-add .ak-select { min-width: 12rem; }
        @media (max-width: 900px) { .pk-row { grid-template-columns: 2.8rem minmax(0, 1fr) auto; } .pk-row-chips { grid-column: 1 / -1; } }
        /* PC(901px 이상)에서만 압축한다: 제목 줄과 도구줄을 한 줄로, 작업 영역의 여백·높이를 줄여 업체를 골라도 스크롤이 거의 생기지 않게 한다. 휴대폰은 손으로 누르기 좋은 기존 크기를 쓴다. */
        .pk-top { display: flex; align-items: center; gap: 0.5rem 1rem; flex-wrap: wrap; }
        .pk-top .page-header { flex: 1 1 22rem; min-width: 0; align-items: center; }
        .pk-top .ak-toolbar { margin-left: auto; }
        @media (max-width: 900px) { .pk-top .ak-toolbar { flex: 1 1 100%; margin-left: 0; } }
        @media (min-width: 901px) {
          .pk-top .page-header-icon { width: 36px; height: 36px; border-radius: 10px; }
          .pk-top .page-sub { margin-top: 0.1rem; line-height: 1.3; }
          .pk-top .ak-toolbar { background: transparent; border: 0; box-shadow: none; padding: 0; }
          .pk-list { max-height: calc(100vh - 9rem); }
          .pk-work-head { padding: 0.5rem 1rem; }
          .pk-rec { padding: 0.4rem 1rem; }
          .pk-tab { padding: 0.25rem 0.75rem; font-size: var(--fs-sm); border-radius: 10px; }
          .pk-foot { padding: 0.5rem 1rem; }
        }
        /* 손으로 누르는 화면(휴대폰·태블릿·터치 입력)에서는 누르는 요소를 44px 이상으로 둔다. PC(마우스)는 촘촘한 크기를 유지한다. */
        @media (max-width: 900px), (pointer: coarse) {
          .pk-x { min-width: 44px; min-height: 44px; align-items: center; justify-content: center; }
          .pk-check { min-height: 44px; }
          .pk-check input { width: 22px; height: 22px; }
        }
        /* 작업 영역 폭이 좁으면(태블릿/좁은 창) 상품 영역을 박스 영역 위로 쌓는다. */
        @media (max-width: 900px) { .pk-layout { grid-template-columns: 1fr; } .pk-list { max-height: none; flex-direction: row; overflow-x: auto; padding-bottom: 0.25rem; } .pk-biz { flex: none; width: 12.5rem; } .pk-biz-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 100%; } }
      `}</style>
    </div>
  );
}

// ─── 상품 칩 ────────────────────────────────────────────────────────────────
// 눌러서 고르면(옮길 박스를 위쪽 이동 줄에서 한 번에 고른다) 끌어서도 옮길 수 있다(마우스용 보조).
function ItemChip({
  item,
  qty,
  remainingLabel,
  fromUid,
  picked,
  mulbongMismatch = false,
  onPick,
}: {
  item: PackingItem;
  qty: number;
  remainingLabel?: string;
  fromUid: string | null;
  picked: boolean;
  mulbongMismatch?: boolean;
  onPick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: fromUid ? `placed:${fromUid}:${item.id}` : `item:${item.id}`, data: fromUid ? { itemId: item.id, fromUid } : { itemId: item.id } });
  const partial = qty < item.quantity - EPS;
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onPick}
      aria-pressed={picked}
      className={`pk-chip ${picked ? 'pk-chip-sel' : ''}`}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <span className="pk-name">{item.name}</span>
      <span className="pk-qty">{remainingLabel ?? `${fmt(qty)}${item.unit}${partial ? ` / ${fmt(item.quantity)}` : ''}`}</span>
      {item.sizeRequest && <span className="pk-size">({item.sizeRequest})</span>}
      {item.aerator ? <span className="pk-aerator">기포기</span> : !fromUid && (item.needsMulbong || item.orderMulbong) && <span className="pk-mulbong">물봉</span>}
      {mulbongMismatch && <span className="pk-warn" title="물봉 포장이 필요한 상품인데 물봉용 박스가 아닙니다">물봉 필요</span>}
    </button>
  );
}

// ─── 아직 안 담은 상품 영역(끌어서 되돌리는 곳이기도 하다) ────────────────────────
function Pool({
  items,
  remainingOf,
  total,
  picked,
  onPick,
}: {
  items: PackingItem[];
  remainingOf: (i: PackingItem) => number;
  total: number;
  picked: Picked | null;
  onPick: (itemId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' });
  return (
    <div ref={setNodeRef} className={`pk-pool ${isOver ? 'pk-pool-over' : ''}`}>
      <span className="pk-pool-title">아직 담지 않은 상품 ({items.length}/{total})</span>
      {items.map((item) => {
        const remaining = remainingOf(item);
        return (
          <ItemChip
            key={item.id}
            item={item}
            qty={remaining}
            remainingLabel={`${fmt(remaining)}${item.unit}${remaining < item.quantity - EPS ? ` / ${fmt(item.quantity)}` : ''}`}
            fromUid={null}
            picked={!!picked && !picked.fromUid && picked.itemId === item.id}
            onPick={() => onPick(item.id)}
          />
        );
      })}
    </div>
  );
}

// ─── 이동 줄: 눌러 둔 상품을 어느 박스로 옮길지 한 번에 고른다 ────────────────────────
// 박스를 보드 안에서 찾아 끌지 않아도 된다. 상품을 누르지 않았을 때도 같은 높이를 차지해 화면이 출렁이지 않는다.
function MoveBar({
  item,
  fromUid,
  boxes,
  boxTypes,
  remaining,
  moveQty,
  weight,
  onMoveQty,
  onWeight,
  onMoveTo,
  onNewBox,
  onRemove,
  onClose,
}: {
  item: PackingItem | null;
  fromUid: string | null;
  boxes: DraftBox[];
  boxTypes: BoxType[];
  remaining: number;
  moveQty: string;
  weight: string;
  onMoveQty: (v: string) => void;
  onWeight: (v: string) => void;
  onMoveTo: (uid: string) => void;
  onNewBox: (typeId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  if (!item) return <div className="pk-move pk-move-idle">상품을 누르면 옮길 박스를 고를 수 있어요 (끌어다 놓아도 됩니다)</div>;
  return (
    <div className="pk-move" role="group" aria-label={`${item.name} 옮기기`}>
      <strong className="pk-move-what">{item.name}</strong>
      <span className="pk-move-label">{fromUid ? '옮길 박스' : '담을 박스'}</span>
      {boxes.map((b, i) => (
        <button key={b.uid} type="button" className="pk-to" disabled={b.uid === fromUid} onClick={() => onMoveTo(b.uid)} title={`${i + 1}번 ${b.name}`}>
          {i + 1}
        </button>
      ))}
      <select className="ak-select pk-to-new" value="" aria-label="새 박스에 담기" onChange={(e) => e.target.value && onNewBox(e.target.value)}>
        <option value="">새 박스…</option>
        {boxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {fromUid && <button type="button" className="pk-to pk-to-out" onClick={onRemove} title="박스에서 빼서 아직 담지 않은 상품으로 돌립니다">빼기</button>}
      {remaining > 1 && (
        <label className="pk-move-opt">
          담을 수량 <input className="pk-mini" type="number" min="0" step="any" placeholder={fmt(remaining)} value={moveQty} onChange={(e) => onMoveQty(e.target.value)} />
        </label>
      )}
      <label className="pk-move-opt">
        실측 kg <input className="pk-mini" type="number" min="0" step="any" placeholder="선택" value={weight} onChange={(e) => onWeight(e.target.value)} />
      </label>
      <button type="button" className="pk-x" onClick={onClose} title="선택 풀기" aria-label="선택 풀기"><X size={15} /></button>
    </div>
  );
}

// ─── 박스 한 줄 ─────────────────────────────────────────────────────────────
function BoxRow({
  box,
  index,
  items,
  boxTypes = [],
  picked = null,
  onPick,
  onChangeType,
  onRemove,
  readOnly = false,
}: {
  box: DraftBox;
  index: number;
  items: PackingItem[];
  // 박스 줄에서 박스 종류를 바꿀 수 있다(담긴 상품은 그대로 유지)
  boxTypes?: BoxType[];
  picked?: Picked | null;
  onPick?: (itemId: string) => void;
  onChangeType?: (boxId: string) => void;
  onRemove?: () => void;
  // 수정 중이 아닐 때: 끌어다 놓기·빼기 없이 어떤 상품이 담겼는지만 보여준다.
  readOnly?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${box.uid}`, disabled: readOnly });
  const itemById = new Map(items.map((i) => [i.id, i]));
  return (
    <div ref={setNodeRef} className={`pk-row ${isOver ? 'pk-row-over' : ''}`}>
      <strong className="pk-row-no">{index}번</strong>
      <div className="pk-row-type">
        {readOnly || !onChangeType ? (
          <span className="pk-slot-name" title={box.dims ? `${box.dims}cm` : undefined}>{box.name}</span>
        ) : (
          <select className="ak-select pk-slot-select" value={box.boxId ?? ''} title={box.dims ? `${box.name} · ${box.dims}cm` : box.name} aria-label={`${index}번 박스 종류`} onChange={(e) => e.target.value && onChangeType(e.target.value)}>
            {box.boxId === null && <option value="">{box.name} (삭제된 박스)</option>}
            {boxTypes.filter((t) => t.is_active || t.id === box.boxId).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <span className="pk-row-meta">
          {box.isMulbong && <span className="pk-mulbong">물봉용</span>}
          {box.boxId === null && <span className="pk-warn">삭제된 박스</span>}
        </span>
      </div>
      <div className="pk-row-chips">
        {box.items.length === 0 && <span className="pk-slot-empty">{readOnly ? '담긴 상품 없음' : '비어 있음 · 상품을 눌러 이 박스로 옮기세요'}</span>}
        {box.items.map((bi) => {
          const item = itemById.get(bi.orderItemId);
          if (!item) return null;
          const mismatch = item.needsMulbong && !box.isMulbong;
          if (readOnly || !onPick) {
            return (
              <span key={bi.orderItemId} className="pk-chip pk-chip-static">
                <span className="pk-name">{item.name}</span>
                <span className="pk-qty">{fmt(bi.quantity)}{item.unit}{bi.quantity < item.quantity - EPS ? ` / ${fmt(item.quantity)}` : ''}</span>
                {mismatch && <span className="pk-warn" title="물봉 포장이 필요한 상품인데 물봉용 박스가 아닙니다">물봉 필요</span>}
              </span>
            );
          }
          return <ItemChip key={bi.orderItemId} item={item} qty={bi.quantity} fromUid={box.uid} picked={!!picked && picked.fromUid === box.uid && picked.itemId === item.id} mulbongMismatch={mismatch} onPick={() => onPick(item.id)} />;
        })}
      </div>
      {!readOnly && onRemove ? <button className="pk-x" onClick={onRemove} title="박스 빼기 (담은 상품은 상품 목록으로 돌아갑니다)" aria-label={`${index}번 박스 빼기`}><X size={16} /></button> : <span />}
    </div>
  );
}

// ─── 합포장 ─────────────────────────────────────────────────────────────────
// 포장이 끝난 뒤 함께 테이핑해 내보낼 박스를 묶는다(라벨에 "합포장 1·2"가 찍히고, 하나만 스캔해도 묶인 박스가 모두 상차된다). 박스 번호를 눌러 고르고 [묶기].
// 묶음은 제출할 때 함께 저장된다. 박스를 지우면 묶음도 따라간다.
function MergeBar({ boxes, groups, onChange }: { boxes: DraftBox[]; groups: UidGroups; onChange: (next: UidGroups) => void }) {
  const [pick, setPick] = useState<string[]>([]);
  const uids = boxes.map((b) => b.uid);
  const seqGroups = seqGroupsFromUid(uids, groups);
  const toggle = (uid: string) => setPick((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]));
  return (
    <div className="pk-merge" role="group" aria-label="합포장">
      <span className="pk-merge-title"><Link2 size={14} aria-hidden /> 합포장</span>
      {seqGroups.map((g) => (
        <span key={g.join('-')} className="pk-merge-group">
          {g.join('·')}번
          <button type="button" className="pk-x" aria-label={`${g.join('·')}번 합포장 풀기`} title="합포장 풀기" onClick={() => onChange(unmergeUids(groups, groups.find((x) => x.includes(uids[g[0] - 1])) ?? []))}>
            <X size={12} />
          </button>
        </span>
      ))}
      {seqGroups.length === 0 && <span className="ak-muted">같이 내보낼 박스를 골라 묶으세요</span>}
      <span className="pk-merge-pick">
        {boxes.map((b, i) => (
          <button key={b.uid} type="button" className={`pk-to ${pick.includes(b.uid) ? 'pk-to-on' : ''}`} aria-pressed={pick.includes(b.uid)} onClick={() => toggle(b.uid)} title={`${i + 1}번 ${b.name}`}>
            {i + 1}
          </button>
        ))}
        <button type="button" className="pk-to pk-to-merge" disabled={pick.length < 2} onClick={() => { onChange(mergeUids(groups, pick)); setPick([]); }}>
          묶기
        </button>
      </span>
    </div>
  );
}
