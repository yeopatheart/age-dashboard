'use client';
import { memo, useMemo, useRef, useState } from 'react';
import { deleteShippingRow, saveCardSettings, saveSalesLines, saveShippingRows, type SalesLineChange } from './actions';
import { useCan } from '@/components/permissions-context';
import { SearchInput } from '@/components/admin/admin-kit';
import { formatWon } from '@/lib/money';
import type { IssuedReceiptKey } from '@/lib/settlement/receipt';
import type { SalesRow } from '@/lib/settlement/sales';
import { SHIPPING_METHODS, shippingKey, shippingLabel, shippingTotals, type ShippingInput, type ShippingMethod, type ShippingRow } from '@/lib/settlement/shipping';
import { SHEET_COLS, SHIPPING_COLS, buildGroups, editLineCells, editShippingCells, groupTotals, isMultiCell, parseClipboard, type SheetCol, type SheetGroup } from '@/lib/settlement/sheet';
import { ReceiptIssuePanel } from './receipt-issue-panel';

// 정산표: 그날 판매·배송비를 고객별로 묶어 한 장으로 입력한다. 칸은 처음부터 입력칸이라 한글·휴대폰 입력이 그대로 되고,
// Enter·방향키로 칸을 옮기고, 엑셀에서 복사한 여러 칸을 붙여넣고, Ctrl+D로 위 칸 값을 채운다. 칸을 벗어나면 바로 저장된다.

type Option = { id: string; name: string };
export interface SheetCard {
  cardId: string;
  boxes: number; // 그날 박스 수(배송비 줄을 직접 추가할 때 기본값)
}
type FlatRow = { kind: 'line'; row: SalesRow } | { kind: 'ship'; row: ShippingRow };
type Op = { kind: 'line'; row: SalesRow; fields: SalesLineChange['fields']; view: Partial<SalesRow> } | { kind: 'ship'; next: ShippingRow };

const COL_LABEL: Record<SheetCol, string> = { product: '품목', quantity: '수량', unit: '단위', unitPrice: '단가', price: '판매가', memo: '메모' };
const NUMERIC: ReadonlySet<SheetCol> = new Set(['quantity', 'unitPrice', 'price']);
const SAVE_FAILED = '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.';
const toInput = (r: ShippingRow): ShippingInput => ({ cardId: r.cardId, method: r.method, boxes: r.boxes, amount: r.amount ?? 0, sellerId: null, paid: false, memo: r.memo || null });
const quantityText = (q: number) => String(Number(q.toFixed(2)));

// 입력칸 하나. 타자를 치는 동안의 글자는 이 칸만 다시 그리게 칸 안에 둔다(표 전체를 다시 그리지 않는다). 칸을 벗어나면 저장한다.
function Cell({ r, c, value, label, disabled, edited, muted, onCommit }: { r: number; c: SheetCol; value: string; label: string; disabled: boolean; edited?: boolean; muted?: boolean; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={`st-cell${NUMERIC.has(c) ? ' is-num' : ''}${edited ? ' is-edited' : ''}${muted ? ' is-auto' : ''}`}
      data-r={r}
      data-c={c}
      value={draft ?? value}
      disabled={disabled}
      aria-label={label}
      inputMode={NUMERIC.has(c) ? 'decimal' : undefined}
      autoComplete="off"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        setDraft(null);
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

interface GroupActions {
  toggle: (cardId: string) => void;
  saveCard: (cardIds: string[], patch: { sellerId?: string | null; paid?: boolean }) => Promise<boolean>;
  addShipping: (g: SheetGroup, method: ShippingMethod, boxes: number) => void;
  commitCell: (target: FlatRow, col: SheetCol, text: string) => void;
  removeShipping: (row: ShippingRow) => Promise<void>;
  exclude: (row: ShippingRow) => void; // 그날 쓰지 않은 수단을 0원으로 뺀다
}

// 고객 묶음 하나(머리줄 + 상품 줄 + 배송비 줄). 칸 하나를 저장할 때 표 전체(수백 줄)를 다시 그리지 않도록, 내용(sig)이 바뀐 묶음만 다시 그린다.
// actions의 함수들은 화면 상태를 읽지 않고 setState만 부르므로(위 apply·saveCard 참고) 예전 렌더의 함수를 그대로 써도 결과가 같다 — 그래서 비교에서 뺀다.
const GroupRows = memo(
  function GroupRows({ g, base, selected, canEdit, sellers, canAddShipping, boxes, nos, actions }: { g: SheetGroup; sig: string; base: number; selected: boolean; canEdit: boolean; sellers: Option[]; canAddShipping: boolean; boxes: number; nos: string; actions: GroupActions }) {
    const totals = groupTotals(g);
    const missing = SHIPPING_METHODS.filter((m) => !g.shipping.some((s) => s.method === m.key));
    return (
      <>
        <tr className="st-group">
          <td className="ak-check">{canEdit && <input type="checkbox" checked={selected} onChange={() => actions.toggle(g.cardId)} aria-label={`${g.customer} 선택`} />}</td>
          <td colSpan={SHEET_COLS.length + 1}>
            <div className="st-group-inner">
              <strong className="st-group-name">{g.customer}</strong>
              <span className="ak-sub">{g.terminal}</span>
              <select className="ak-select ak-select-seller" value={g.sellerId ?? ''} disabled={!canEdit} aria-label={`${g.customer} 사업자 구분`} onChange={(e) => void actions.saveCard([g.cardId], { sellerId: e.target.value === '' ? null : e.target.value })}>
                <option value="">사업자 미지정</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="ak-select" value={g.paid ? 'Y' : 'N'} disabled={!canEdit} aria-label={`${g.customer} 입금 여부`} style={g.paid ? { color: '#047857' } : undefined} onChange={(e) => void actions.saveCard([g.cardId], { paid: e.target.value === 'Y' })}>
                <option value="N">입금 N</option>
                <option value="Y">입금 Y</option>
              </select>
              {canEdit && canAddShipping && missing.length > 0 && (
                <select className="ak-select" value="" aria-label={`${g.customer} 배송비 추가`} onChange={(e) => e.target.value && actions.addShipping(g, e.target.value as ShippingMethod, boxes)}>
                  <option value="">＋ 배송비</option>
                  {missing.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              )}
              {nos !== '' && <span className="ak-sub" title="이미 발행한 영수증 번호">영수증 NO.{nos}</span>}
              <span className="ak-spacer" />
              {totals.unpriced > 0 && <span className="ak-sub" style={{ color: '#b45309' }}>미입력 {totals.unpriced}줄</span>}
              <span className="st-group-total">
                {totals.shipping > 0 && <span className="ak-sub">상품 {formatWon(totals.goods)} + 배송비 {formatWon(totals.shipping)} = </span>}
                <strong>{formatWon(totals.total)}원</strong>
              </span>
            </div>
          </td>
        </tr>
        {g.lines.map((l, i) => {
          const r = base + i;
          const target: FlatRow = { kind: 'line', row: l };
          const name = `${g.customer} ${l.product}`;
          const origin = l.edited ? `주문 목록: ${l.original.product} ${quantityText(l.original.quantity)}${l.original.unit}` : undefined;
          return (
            <tr key={l.itemId} title={origin}>
              <td />
              <td><Cell r={r} c="product" value={l.product} label={`${name} 품목`} disabled={!canEdit} edited={l.product !== l.original.product} onCommit={(text) => actions.commitCell(target, 'product', text)} /></td>
              <td><Cell r={r} c="quantity" value={quantityText(l.quantity)} label={`${name} 수량`} disabled={!canEdit} edited={l.quantity !== l.original.quantity} onCommit={(text) => actions.commitCell(target, 'quantity', text)} /></td>
              <td><Cell r={r} c="unit" value={l.unit} label={`${name} 단위`} disabled={!canEdit} edited={l.unit !== l.original.unit} onCommit={(text) => actions.commitCell(target, 'unit', text)} /></td>
              <td><Cell r={r} c="unitPrice" value={formatWon(l.unitPrice)} label={`${name} 단가`} disabled={!canEdit} onCommit={(text) => actions.commitCell(target, 'unitPrice', text)} /></td>
              <td><Cell r={r} c="price" value={formatWon(l.price)} label={`${name} 판매가`} disabled={!canEdit} onCommit={(text) => actions.commitCell(target, 'price', text)} /></td>
              <td><Cell r={r} c="memo" value={l.memo} label={`${name} 메모`} disabled={!canEdit} onCommit={(text) => actions.commitCell(target, 'memo', text)} /></td>
              <td />
            </tr>
          );
        })}
        {g.shipping.map((s, i) => {
          const r = base + g.lines.length + i;
          const target: FlatRow = { kind: 'ship', row: s };
          const name = `${g.customer} ${shippingLabel(s.method)}`;
          const excluded = s.saved && s.amount === 0;
          return (
            <tr key={s.key} className="st-ship">
              <td />
              <td>
                <span className="st-ship-name" title={s.quickBlocked ? '이 터미널은 퀵이 안 되는 곳으로 설정돼 있습니다. 저장된 값은 그대로 둡니다.' : undefined}>
                  {shippingLabel(s.method)}
                  {s.quickBlocked && <span style={{ color: '#b45309' }}> ⚠</span>}
                  {!s.saved && <span className="ak-sub" title="터미널 설정(박스당 금액 × 박스 수)으로 자동 계산한 값입니다. 고치면 그 값으로 저장됩니다."> 자동</span>}
                  {excluded && <span className="ak-sub" title="이 날은 쓰지 않아 뺀 줄입니다(0원). 영수증과 합계에 들어가지 않습니다."> 뺌</span>}
                </span>
              </td>
              <td><Cell r={r} c="quantity" value={String(s.boxes)} label={`${name} 박스 수`} disabled={!canEdit} onCommit={(text) => actions.commitCell(target, 'quantity', text)} /></td>
              <td><span className="ak-sub">박스</span></td>
              <td className="ak-right"><span className="ak-sub">{s.rate !== null ? formatWon(s.rate) : ''}</span></td>
              <td><Cell r={r} c="price" value={formatWon(s.amount)} label={`${name} 배송비`} disabled={!canEdit} muted={!s.saved || excluded} onCommit={(text) => actions.commitCell(target, 'price', text)} /></td>
              <td><Cell r={r} c="memo" value={s.memo} label={`${name} 메모`} disabled={!canEdit} onCommit={(text) => actions.commitCell(target, 'memo', text)} /></td>
              <td className="ak-fit">
                {canEdit && (s.saved ? (
                  <button className="ak-btn st-row-btn" onClick={() => void actions.removeShipping(s)} title={excluded ? '뺀 줄을 되돌립니다(터미널 설정이 있으면 자동 계산으로 돌아갑니다).' : '저장한 값을 지웁니다(터미널 설정이 있으면 자동 계산으로 돌아갑니다).'}>{excluded ? '되돌리기' : '지우기'}</button>
                ) : (
                  <button className="ak-btn st-row-btn" onClick={() => actions.exclude(s)} title="이 날은 이 수단을 쓰지 않았습니다. 영수증과 합계에서 뺍니다.">빼기</button>
                ))}
              </td>
            </tr>
          );
        })}
      </>
    );
  },
  (a, b) => a.sig === b.sig && a.base === b.base && a.selected === b.selected && a.canEdit === b.canEdit && a.sellers === b.sellers && a.canAddShipping === b.canAddShipping && a.boxes === b.boxes && a.nos === b.nos,
);

export function SheetClient({
  rows,
  shipping,
  cards,
  sellers,
  date,
  issued,
}: {
  rows: SalesRow[];
  shipping: ShippingRow[] | null; // null = 배송비 테이블·설정이 아직 없음(마이그레이션 전)
  cards: SheetCard[];
  sellers: Option[];
  date: string;
  issued: IssuedReceiptKey[]; // 이 날짜에 이미 발행한 영수증
}) {
  const canEdit = useCan()('settlement:edit');
  const tableRef = useRef<HTMLTableElement>(null);
  // 저장 결과를 기다리지 않고 화면에 바로 보이는 값(실패하면 되돌린다). 날짜를 옮기면 화면 상태가 새로 시작된다.
  const [lineEdits, setLineEdits] = useState<Record<string, Partial<SalesRow>>>({});
  const [shipEdits, setShipEdits] = useState<Record<string, ShippingRow>>({}); // 고치거나 새로 추가한 배송비 줄(전체 값)
  const [cardEdits, setCardEdits] = useState<Record<string, { sellerId?: string | null; paid?: boolean }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set()); // 선택한 고객 카드
  const [search, setSearch] = useState('');
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [saving, setSaving] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo(() => {
    const viewLines = rows.map((r) => ({ ...r, ...lineEdits[r.itemId] }));
    const known = new Set((shipping ?? []).map((s) => s.key));
    const viewShipping = [...(shipping ?? []).map((s) => shipEdits[s.key] ?? s), ...Object.values(shipEdits).filter((s) => !known.has(s.key))];
    return buildGroups(viewLines, viewShipping).map((g): SheetGroup => {
      const edit = cardEdits[g.cardId];
      if (!edit) return g;
      const sellerId = edit.sellerId !== undefined ? edit.sellerId : g.sellerId;
      const paid = edit.paid ?? g.paid;
      return { ...g, sellerId, paid, lines: g.lines.map((l) => ({ ...l, sellerId, paid })), shipping: g.shipping.map((s) => ({ ...s, sellerId, paid })) };
    });
  }, [rows, shipping, lineEdits, shipEdits, cardEdits]);

  const shownGroups = useMemo(() => {
    const k = search.trim().toLowerCase();
    return k ? groups.filter((g) => g.customer.toLowerCase().includes(k) || g.lines.some((l) => l.product.toLowerCase().includes(k))) : groups;
  }, [groups, search]);
  // 화면에 보이는 줄을 위에서 아래로 번호 매긴 것(칸 이동·붙여넣기의 행 번호).
  const flat: FlatRow[] = shownGroups.flatMap((g) => [...g.lines.map((row): FlatRow => ({ kind: 'line', row })), ...g.shipping.map((row): FlatRow => ({ kind: 'ship', row }))]);
  const rowNo = new Map(flat.map((f, i) => [f.kind === 'line' ? f.row.itemId : f.row.key, i]));
  const boxesOf = new Map(cards.map((c) => [c.cardId, c.boxes]));

  const allLines = groups.flatMap((g) => g.lines);
  const goodsTotal = allLines.reduce((sum, l) => sum + (l.price ?? 0), 0);
  const ship = shippingTotals(groups.flatMap((g) => g.shipping));
  const unpriced = allLines.filter((l) => l.price === null).length;
  const paidGroups = groups.filter((g) => g.paid).length;

  const markSaved = () => {
    setJustSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
  };

  // 여러 줄의 변경을 한꺼번에 저장한다. 화면에 먼저 반영하고, 실패하면 이전 값으로 되돌린다.
  const apply = async (ops: Op[]): Promise<boolean> => {
    if (ops.length === 0) return false;
    setError(null);
    setNotice(null);
    const lineOps = ops.filter((o) => o.kind === 'line');
    const shipOps = ops.filter((o) => o.kind === 'ship');
    if (lineOps.length > 0) setLineEdits((prev) => ({ ...prev, ...Object.fromEntries(lineOps.map((o) => [o.row.itemId, { ...prev[o.row.itemId], ...o.view }])) }));
    if (shipOps.length > 0) setShipEdits((prev) => ({ ...prev, ...Object.fromEntries(shipOps.map((o) => [o.next.key, o.next])) }));
    setSaving((n) => n + 1);
    const failed = { error: SAVE_FAILED };
    const [lineResult, shipResult] = await Promise.all([
      lineOps.length > 0 ? saveSalesLines(lineOps.map((o) => ({ itemId: o.row.itemId, fields: o.fields }))).catch(() => failed) : { error: null },
      shipOps.length > 0 ? saveShippingRows(shipOps.map((o) => toInput(o.next))).catch(() => failed) : { error: null },
    ]);
    setSaving((n) => n - 1);
    // 실패하면 그 줄들의 화면 값을 걷어 내 서버 값으로 되돌린다(앞서 저장에 성공한 값은 서버 값에 이미 들어 있다).
    const drop = <T,>(prev: Record<string, T>, keys: string[]) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    };
    if (lineResult.error) setLineEdits((prev) => drop(prev, lineOps.map((o) => o.row.itemId)));
    if (shipResult.error) setShipEdits((prev) => drop(prev, shipOps.map((o) => o.next.key)));
    const problem = lineResult.error ?? shipResult.error;
    if (problem) {
      setError(problem);
      return false;
    }
    markSaved();
    return true;
  };

  // 한 줄의 칸(들)에 적은 글자를 저장할 변경으로 바꾼다. 잘못된 값이면 { error }, 바뀐 것이 없으면 null.
  const toOp = (target: FlatRow, cells: [SheetCol, string][]): Op | { error: string } | null => {
    if (target.kind === 'line') {
      const edit = editLineCells(target.row, cells);
      return edit === null || 'error' in edit ? edit : { kind: 'line', row: target.row, fields: edit.fields, view: edit.view };
    }
    const edit = editShippingCells(target.row, cells);
    return edit === null || 'error' in edit ? edit : { kind: 'ship', next: edit.next };
  };
  const commitCell = (target: FlatRow, col: SheetCol, text: string) => {
    const op = toOp(target, [[col, text]]);
    if (op === null) return;
    if ('error' in op) return setError(op.error);
    void apply([op]);
  };

  const saveCard = async (cardIds: string[], patch: { sellerId?: string | null; paid?: boolean }) => {
    setError(null);
    setNotice(null);
    setCardEdits((prev) => ({ ...prev, ...Object.fromEntries(cardIds.map((id) => [id, { ...prev[id], ...patch }])) }));
    setSaving((n) => n + 1);
    const result = await saveCardSettings(cardIds, patch).catch(() => ({ error: SAVE_FAILED }));
    setSaving((n) => n - 1);
    if (result.error) {
      setCardEdits((prev) => {
        const next = { ...prev };
        for (const id of cardIds) delete next[id];
        return next;
      });
      setError(result.error);
      return false;
    }
    markSaved();
    return true;
  };

  const removeShipping = async (r: ShippingRow) => {
    setError(null);
    setNotice(null);
    setSaving((n) => n + 1);
    const result = await deleteShippingRow(r.cardId, r.method).catch(() => ({ error: '지우지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
    if (result.error) return setError(result.error);
    setShipEdits((prev) => {
      const next = { ...prev };
      delete next[r.key];
      return next;
    });
  };

  const addShipping = (g: SheetGroup, method: ShippingMethod, boxes: number) => {
    const next: ShippingRow = { key: shippingKey(g.cardId, method), cardId: g.cardId, orderDate: date, customer: g.customer, terminal: g.terminal, method, boxes, rate: null, amount: 0, saved: true, sellerId: g.sellerId, paid: g.paid, memo: '', quickBlocked: false };
    void apply([{ kind: 'ship', next }]);
  };

  // ── 칸 이동·채우기·붙여넣기(표 전체에서 한 번에 처리한다) ──────────────────────────────
  const cellAt = (r: number, c: SheetCol) => tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`) ?? null;
  const focusVertical = (r: number, c: SheetCol, step: 1 | -1) => {
    for (let n = r + step; n >= 0 && n < flat.length; n += step) {
      const el = cellAt(n, c);
      if (el && !el.disabled) return el.focus();
    }
  };
  const focusHorizontal = (r: number, c: SheetCol, step: 1 | -1) => {
    for (let i = SHEET_COLS.indexOf(c) + step; i >= 0 && i < SHEET_COLS.length; i += step) {
      const el = cellAt(r, SHEET_COLS[i]);
      if (el && !el.disabled) return el.focus();
    }
  };
  const targetCell = (target: EventTarget): { el: HTMLInputElement; r: number; c: SheetCol } | null => {
    if (!(target instanceof HTMLInputElement) || target.dataset.r === undefined || target.dataset.c === undefined) return null;
    return { el: target, r: Number(target.dataset.r), c: target.dataset.c as SheetCol };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const cell = targetCell(e.target);
    if (!cell || e.nativeEvent.isComposing) return; // 한글 조합 중에는 Enter·방향키를 가로채지 않는다
    const { el, r, c } = cell;
    if (e.key === 'Enter') {
      e.preventDefault();
      const before = document.activeElement;
      focusVertical(r, c, e.shiftKey ? -1 : 1);
      if (document.activeElement === before) el.blur(); // 맨 끝 줄: 옮길 곳이 없어도 저장은 한다
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusVertical(r, c, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      focusHorizontal(r, c, -1);
    } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      e.preventDefault();
      focusHorizontal(r, c, 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      // 아래로 채우기: 바로 위(같은 열이 있는 줄)의 값을 이 칸에 넣는다.
      e.preventDefault();
      for (let n = r - 1; n >= 0; n--) {
        const above = cellAt(n, c);
        if (!above) continue;
        el.blur();
        commitCell(flat[r], c, above.value);
        requestAnimationFrame(() => el.focus());
        break;
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTableElement>) => {
    const cell = targetCell(e.target);
    if (!cell) return;
    const text = e.clipboardData.getData('text/plain');
    if (!isMultiCell(text)) return; // 한 칸은 브라우저 기본 붙여넣기
    e.preventDefault();
    cell.el.blur();
    const c0 = SHEET_COLS.indexOf(cell.c);
    const ops: Op[] = [];
    let filled = 0;
    for (const [i, cells] of parseClipboard(text).entries()) {
      const target = flat[cell.r + i];
      if (!target) break;
      const allowed: readonly SheetCol[] = target.kind === 'line' ? SHEET_COLS : SHIPPING_COLS;
      const entries = cells.flatMap((value, j): [SheetCol, string][] => {
        const col = SHEET_COLS[c0 + j];
        return col && allowed.includes(col) ? [[col, value]] : [];
      });
      const op = toOp(target, entries);
      if (op === null) continue;
      if ('error' in op) return setError(`붙여넣지 않았습니다. ${cell.r + i + 1}번째 줄: ${op.error}`);
      ops.push(op);
      filled += entries.length;
    }
    if (ops.length === 0) return setNotice('붙여넣은 값이 지금 값과 같습니다.');
    void apply(ops).then((ok) => ok && setNotice(`${ops.length}줄 ${filled}칸을 붙여넣었습니다.`));
    requestAnimationFrame(() => cell.el.focus());
  };

  // ── 선택(영수증·입금 일괄) ─────────────────────────────────────────────────────
  const toggle = (cardId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  const allShownSelected = shownGroups.length > 0 && shownGroups.every((g) => selected.has(g.cardId));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shownGroups.map((g) => g.cardId)));
  const selectedGroups = groups.filter((g) => selected.has(g.cardId));
  const issuedNos = (g: SheetGroup) => issued.filter((r) => r.orderDate === date && r.customerName === g.customer.slice(0, 60)).map((r) => r.receiptNo).sort((a, b) => a - b);

  return (
    <>
      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="고객명·품목 검색" />
        <span className="ak-count">고객 {shownGroups.length}곳{shownGroups.length !== groups.length ? ` / 전체 ${groups.length}곳` : ''}</span>
        <span>상품 <strong>{formatWon(goodsTotal)}원</strong></span>
        {shipping && <span>배송비 <strong>{formatWon(ship.total)}원</strong></span>}
        <span>합계 <strong>{formatWon(goodsTotal + ship.total)}원</strong></span>
        <span className="ak-sub">판매가 미입력 {unpriced}줄 · 입금 {paidGroups}/{groups.length}곳</span>
        <span className="ak-spacer" />
        <span className="ak-sub" role="status" aria-live="polite">{saving > 0 ? '저장 중…' : justSaved ? '저장됨 ✓' : canEdit ? '자동 저장' : ''}</span>
      </div>

      {canEdit && selected.size > 0 && (
        <div className="ak-bulk ak-bulk-fixed">
          <div className="ak-bulk-head">
            <strong>고객 {selected.size}곳 선택됨</strong>
            <button className="ak-btn" onClick={() => setSelected(new Set())}>선택 해제</button>
            <button className="ak-btn ak-btn-primary" onClick={() => setReceiptOpen(true)} title="선택한 고객의 줄을 고객사 × 사업자 × 출고일로 묶어 영수증 이미지를 만듭니다(배송비 포함)">영수증 만들기</button>
            <button className="ak-btn" onClick={() => void saveCard([...selected], { paid: true })} disabled={saving > 0}>입금 Y로</button>
            <button className="ak-btn" onClick={() => void saveCard([...selected], { paid: false })} disabled={saving > 0}>입금 N으로</button>
          </div>
        </div>
      )}

      {canEdit && groups.length > 0 && (
        <p className="ak-meta">
          칸을 벗어나면 바로 저장됩니다. Enter·방향키로 칸을 옮기고, Ctrl+D로 위 칸 값을 채우고, 엑셀에서 복사한 여러 칸을 붙여넣을 수 있습니다. 수량 칸에 실중량을 적으면 단가 × 수량으로 판매가가 계산됩니다(직접 적은 판매가는 바꾸지 않습니다). 칸을 비우면 주문 목록 값으로 돌아갑니다.
        </p>
      )}
      {error && <p className="ak-error ak-flash" role="alert">{error}</p>}
      {notice && <p className="ak-notice ak-flash" role="status">{notice}</p>}
      {sellers.length === 0 && groups.length > 0 && <p className="ak-muted">등록된 사업자가 없습니다. “사업자 관리”에서 먼저 등록하면 사업자 구분을 고를 수 있습니다.</p>}

      <div className="ak-table-wrap">
        <table className="ak-table st-sheet" ref={tableRef} onKeyDown={onKeyDown} onPaste={onPaste}>
          <thead>
            <tr>
              <th className="ak-check">{canEdit && <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="보이는 고객 모두 선택" />}</th>
              {SHEET_COLS.map((c) => <th key={c} scope="col" className={NUMERIC.has(c) ? 'ak-right' : undefined}>{COL_LABEL[c]}</th>)}
              <th aria-label="줄 동작" />
            </tr>
          </thead>
          <tbody>
            {shownGroups.length === 0 && (
              <tr><td colSpan={SHEET_COLS.length + 2} className="ak-muted" style={{ textAlign: 'center' }}>{groups.length === 0 ? '이 날짜에 출고가 끝난 주문이 없습니다.' : '조건에 맞는 고객이 없습니다.'}</td></tr>
            )}
            {shownGroups.map((g) => (
              <GroupRows
                key={g.cardId}
                g={g}
                sig={JSON.stringify(g)}
                base={rowNo.get(g.lines[0]?.itemId ?? g.shipping[0]?.key ?? '') ?? 0}
                selected={selected.has(g.cardId)}
                canEdit={canEdit}
                sellers={sellers}
                canAddShipping={shipping !== null}
                boxes={boxesOf.get(g.cardId) ?? 1}
                nos={issuedNos(g).join(', ')}
                actions={{ toggle, saveCard, addShipping, commitCell, removeShipping, exclude: (row) => void apply([{ kind: 'ship', next: { ...row, amount: 0, saved: true } }]) }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {receiptOpen && (
        <ReceiptIssuePanel rows={selectedGroups.flatMap((g) => g.lines)} shipping={selectedGroups.flatMap((g) => g.shipping)} sellers={sellers} from={date} to={date} issued={issued} saving={saving > 0} onClose={() => setReceiptOpen(false)} />
      )}
    </>
  );
}
