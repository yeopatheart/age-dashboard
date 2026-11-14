'use client';
import { useMemo, useState } from 'react';
import { deleteShippingRow, saveShippingRows } from './actions';
import { useCan } from '@/components/permissions-context';
import { DataTable, type Column } from '@/components/admin/admin-kit';
import { formatWon, formatWonDraft, parseWon, wonInputError } from '@/lib/money';
import { MAX_BOXES, SHIPPING_METHODS, shippingLabel, shippingTotals, suggestAmount, type ShippingInput, type ShippingMethod, type ShippingRow } from '@/lib/settlement/shipping';

const PAGE_SIZE = 100; // 월 조회는 줄이 많을 수 있어 100줄씩 나눠 보여 준다
const EMPTY_HIDDEN = new Set<string>();

type Edit = Partial<Pick<ShippingRow, 'boxes' | 'amount' | 'sellerId' | 'paid' | 'memo' | 'saved'>>;
type Drafts = Record<string, { amount?: string; boxes?: string; memo?: string }>;
type Option = { id: string; name: string };
// 배송비 줄을 직접 추가할 수 있는 카드(출고 완료된 그날 고객 카드)
export interface ShippingCardOption {
  cardId: string;
  orderDate: string;
  customer: string;
  terminal: string;
  label: string; // "11.13 고객명 · 터미널"
  boxes: number;
  sellerId: string | null;
}

const toInput = (r: ShippingRow): ShippingInput => ({ cardId: r.cardId, method: r.method, boxes: r.boxes, amount: r.amount ?? 0, sellerId: r.sellerId, paid: r.paid, memo: r.memo });

export function ShippingClient({ rows, sellers, cardOptions }: { rows: ShippingRow[]; sellers: Option[]; cardOptions: ShippingCardOption[] }) {
  const canEdit = useCan()('settlement:edit');
  // 저장 결과를 기다리지 않고 화면에 바로 보이는 값(실패하면 되돌린다). 날짜를 옮기면 화면 상태가 새로 시작된다.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [drafts, setDrafts] = useState<Drafts>({}); // 입력 중인 박스 수·금액·메모(칸을 벗어날 때 저장한다)
  const [added, setAdded] = useState<ShippingRow[]>([]); // 방금 직접 추가한 줄(서버 새로고침이 오기 전까지)
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addCard, setAddCard] = useState('');
  const [addMethod, setAddMethod] = useState<ShippingMethod>('bus');
  const [page, setPage] = useState(0);

  const view = (r: ShippingRow): ShippingRow => ({ ...r, ...edits[r.key] });
  const allRows = useMemo(() => {
    const keys = new Set(rows.map((r) => r.key));
    return [...rows, ...added.filter((r) => !keys.has(r.key))];
  }, [rows, added]);
  const shown = allRows.map(view);
  const totals = shippingTotals(shown);
  const sellerName = new Map(sellers.map((s) => [s.id, s.name]));

  // 한 줄의 값을 바꿔 저장한다(제안 줄이면 이때 처음 저장된다). 화면에 먼저 반영하고 실패하면 되돌린다.
  const commit = async (r0: ShippingRow, patch: Partial<Pick<ShippingRow, 'boxes' | 'amount' | 'sellerId' | 'paid' | 'memo'>>): Promise<boolean> => {
    const next = { ...view(r0), ...patch };
    setError(null);
    setNotice(null);
    const previous = edits[r0.key];
    setEdits((prev) => ({ ...prev, [r0.key]: { ...prev[r0.key], ...patch, saved: true } }));
    setSaving((n) => n + 1);
    const result = await saveShippingRows([toInput(next)]).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
    if (result.error) {
      setEdits((prev) => {
        const copy = { ...prev };
        if (previous) copy[r0.key] = previous;
        else delete copy[r0.key];
        return copy;
      });
      setError(result.error);
      return false;
    }
    return true;
  };

  // 아직 저장하지 않은 제안 줄을 한꺼번에 저장한다(저장해야 영수증에 들어간다).
  const saveSuggestions = async () => {
    const targets = shown.filter((r) => !r.saved && r.amount !== null);
    if (targets.length === 0) return;
    setError(null);
    setNotice(null);
    setSaving((n) => n + 1);
    const result = await saveShippingRows(targets.map(toInput)).catch(() => ({ error: '저장하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
    if (result.error) return setError(result.error);
    setEdits((prev) => ({ ...prev, ...Object.fromEntries(targets.map((r) => [r.key, { ...prev[r.key], saved: true }])) }));
    setNotice(`제안 ${targets.length}건을 저장했습니다.`);
  };

  const remove = async (r: ShippingRow) => {
    setError(null);
    setNotice(null);
    setSaving((n) => n + 1);
    const result = await deleteShippingRow(r.cardId, r.method).catch(() => ({ error: '삭제하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setSaving((n) => n - 1);
    if (result.error) return setError(result.error);
    setAdded((prev) => prev.filter((x) => x.key !== r.key));
    setEdits((prev) => {
      const copy = { ...prev };
      delete copy[r.key];
      return copy;
    });
  };

  const addRow = async () => {
    const opt = cardOptions.find((c) => c.cardId === addCard);
    if (!opt) return;
    const row: ShippingRow = {
      key: `${opt.cardId}|${addMethod}`,
      cardId: opt.cardId,
      orderDate: opt.orderDate,
      customer: opt.customer,
      terminal: opt.terminal,
      method: addMethod,
      boxes: opt.boxes,
      rate: null,
      amount: 0,
      saved: false,
      sellerId: opt.sellerId,
      paid: false,
      memo: '',
      quickBlocked: false,
    };
    if (allRows.some((r) => r.key === row.key)) return setError(`이미 있는 줄입니다: ${opt.label} · ${shippingLabel(addMethod)}`);
    if (await commit(row, {})) {
      setAdded((prev) => [...prev, { ...row, saved: true }]);
      setAddCard('');
    }
  };

  const setDraft = (key: string, field: 'amount' | 'boxes' | 'memo', value: string) => setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const clearDraft = (key: string, field: 'amount' | 'boxes' | 'memo') =>
    setDrafts((prev) => {
      const { [field]: _removed, ...rest } = prev[key] ?? {};
      void _removed;
      return { ...prev, [key]: rest };
    });

  const columns: Column<ShippingRow & { no: number }>[] = [
    { key: 'no', label: '번호', hideable: false, className: 'ak-fit', render: (r) => r.no },
    {
      key: 'customer',
      label: '고객명',
      hideable: false,
      render: (r) => (
        <span title={r.terminal ? `터미널: ${r.terminal}` : undefined}>
          <strong>{r.customer}</strong>
          {r.terminal && <span className="ak-muted"> · {r.terminal}</span>}
        </span>
      ),
    },
    {
      key: 'method',
      label: '수단',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const r = view(r0);
        return (
          <span title={r.quickBlocked ? '이 터미널은 퀵이 안 되는 곳으로 설정돼 있습니다. 저장된 값은 그대로 둡니다.' : undefined}>
            <strong>{shippingLabel(r.method)}</strong>
            {r.quickBlocked && <span style={{ color: '#b45309' }}> ⚠</span>}
            {!r.saved && <span className="ak-badge" style={{ marginLeft: 6 }} title="터미널 설정으로 만든 제안입니다. 값을 고치거나 저장하면 확정되고 영수증에 들어갑니다. 쓰지 않은 날은 '빼기'를 누르세요.">제안</span>}
            {r.saved && r.amount === 0 && <span className="ak-badge" style={{ marginLeft: 6 }} title="이 날은 쓰지 않아 뺀 줄입니다(0원). 영수증과 합계에 들어가지 않습니다.">뺌</span>}
          </span>
        );
      },
    },
    {
      key: 'boxes',
      label: '박스',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const r = view(r0);
        return (
          <input
            className="ak-input"
            style={{ width: '4.5rem', height: '2.1rem', textAlign: 'right' }}
            inputMode="numeric"
            disabled={!canEdit}
            aria-label={`${r.customer} ${shippingLabel(r.method)} 박스 수`}
            value={drafts[r.key]?.boxes ?? String(r.boxes)}
            onChange={(e) => setDraft(r.key, 'boxes', e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => {
              const draft = drafts[r.key]?.boxes;
              if (draft === undefined) return;
              clearDraft(r.key, 'boxes');
              const next = draft === '' ? NaN : Number(draft);
              if (!Number.isInteger(next) || next < 0 || next > MAX_BOXES) return setError(`박스 수를 저장하지 않았습니다. 0~${MAX_BOXES.toLocaleString('ko-KR')} 사이 정수로 입력해주세요.`);
              if (next === r.boxes) return;
              // 아직 저장하지 않은 제안이면 박스 수에 맞춰 금액도 다시 계산한다(저장한 줄의 금액은 그대로 둔다).
              void commit(r0, !r.saved && r.rate !== null ? { boxes: next, amount: suggestAmount(r.rate, next) } : { boxes: next });
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    {
      key: 'amount',
      label: '배송비(원)',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        const invalid = wonInputError(drafts[r.key]?.amount ?? '') !== null;
        return (
          <input
            className="ak-input"
            style={{ width: '9rem', height: '2.1rem', textAlign: 'right', ...(invalid ? { borderColor: 'var(--danger)' } : {}), ...(!r.saved ? { color: 'var(--muted-foreground)' } : {}) }}
            aria-invalid={invalid}
            inputMode="numeric"
            placeholder="0"
            disabled={!canEdit}
            aria-label={`${r.customer} ${shippingLabel(r.method)} 배송비`}
            value={drafts[r.key]?.amount ?? formatWon(r.amount)}
            onChange={(e) => setDraft(r.key, 'amount', formatWonDraft(e.target.value))}
            onBlur={() => {
              const draft = drafts[r.key]?.amount;
              if (draft === undefined) return;
              clearDraft(r.key, 'amount');
              const problem = wonInputError(draft);
              if (problem) return setError(`배송비를 저장하지 않았습니다. ${problem}`);
              const next = parseWon(draft) ?? 0;
              if (next !== r.amount || !r.saved) void commit(r0, { amount: next });
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    {
      key: 'seller',
      label: '사업자 구분',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        return (
          <select
            className="ak-select ak-select-seller"
            value={r.sellerId ?? ''}
            disabled={!canEdit}
            aria-label={`${r.customer} ${shippingLabel(r.method)} 사업자 구분`}
            title={r.sellerId && !r.saved ? `${sellerName.get(r.sellerId) ?? ''}: 이 고객의 판매내역 사업자를 따릅니다` : undefined}
            onChange={(e) => void commit(r0, { sellerId: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">미지정</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      },
    },
    {
      key: 'paid',
      label: '입금',
      hideable: false,
      className: 'ak-fit',
      render: (r0) => {
        const r = view(r0);
        return (
          <select
            className="ak-select"
            value={r.paid ? 'Y' : 'N'}
            disabled={!canEdit}
            aria-label={`${r.customer} ${shippingLabel(r.method)} 입금 여부`}
            style={r.paid ? { color: '#047857' } : undefined}
            onChange={(e) => void commit(r0, { paid: e.target.value === 'Y' })}
          >
            <option value="N">N</option>
            <option value="Y">Y</option>
          </select>
        );
      },
    },
    {
      key: 'memo',
      label: '메모',
      hideable: false,
      render: (r0) => {
        const r = view(r0);
        return (
          <input
            className="ak-input"
            style={{ width: '12rem', height: '2.1rem' }}
            maxLength={500}
            disabled={!canEdit}
            aria-label={`${r.customer} ${shippingLabel(r.method)} 메모`}
            value={drafts[r.key]?.memo ?? r.memo}
            onChange={(e) => setDraft(r.key, 'memo', e.target.value)}
            onBlur={() => {
              const draft = drafts[r.key]?.memo;
              if (draft === undefined) return;
              clearDraft(r.key, 'memo');
              if (draft.trim() !== r.memo) void commit(r0, { memo: draft.trim() });
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
          />
        );
      },
    },
    ...(canEdit
      ? [
          {
            key: 'remove',
            label: '',
            hideable: false,
            className: 'ak-fit',
            render: (r0: ShippingRow) => {
              const r = view(r0);
              return r.saved ? (
                <button className="ak-btn" onClick={() => void remove(r0)} disabled={saving > 0} title={r.amount === 0 ? '뺀 줄을 되돌립니다. 설정으로 제안할 수 있는 줄은 제안으로 다시 나타납니다.' : '저장한 배송비를 지웁니다. 설정으로 제안할 수 있는 줄은 제안으로 다시 나타납니다.'}>지우기</button>
              ) : (
                <button className="ak-btn" onClick={() => void commit(r0, { amount: 0 })} disabled={saving > 0} title="이 날은 이 수단을 쓰지 않았습니다. 영수증과 합계에서 뺍니다.">빼기</button>
              );
            },
          } satisfies Column<ShippingRow & { no: number }>,
        ]
      : []),
  ];

  const numbered = shown.map((r, i) => ({ ...r, no: i + 1 }));
  const pageCount = Math.max(1, Math.ceil(numbered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = numbered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return (
    <>
      <div className="ak-toolbar">
        <span className="ak-count">배송비 {totals.rows}줄</span>
        <span>저장한 배송비 합계 <strong>{formatWon(totals.total)}원</strong></span>
        {totals.suggested > 0 && <span className="ak-sub">제안 {totals.suggested}건(저장 전)</span>}
        <span className="ak-spacer" />
        {saving > 0 && <span className="ak-sub">저장 중…</span>}
        {canEdit && totals.suggested > 0 && (
          <button className="ak-btn ak-btn-primary" onClick={() => void saveSuggestions()} disabled={saving > 0}>제안 {totals.suggested}건 모두 저장</button>
        )}
      </div>
      <p className="ak-sub" style={{ margin: 0 }}>
        터미널 관리의 수단별 박스당 금액 × 박스 수로 줄을 제안합니다(퀵은 고객사 관리에서 &ldquo;퀵 이용&rdquo;을 켠 고객만). 값을 고치거나 저장하면 확정되고, 확정된 배송비만 영수증과 합계에 들어갑니다. 그날 쓰지 않은 수단은 &ldquo;빼기&rdquo;를 누르세요.
      </p>

      {canEdit && cardOptions.length > 0 && (
        <div className="ak-toolbar">
          <select className="ak-select" value={addCard} onChange={(e) => setAddCard(e.target.value)} aria-label="배송비를 추가할 고객">
            <option value="">배송비를 추가할 고객 선택</option>
            {cardOptions.map((c) => <option key={c.cardId} value={c.cardId}>{c.label}</option>)}
          </select>
          <select className="ak-select" value={addMethod} onChange={(e) => setAddMethod(e.target.value as ShippingMethod)} aria-label="수단">
            {SHIPPING_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button className="ak-btn" onClick={() => void addRow()} disabled={saving > 0 || addCard === ''}>줄 추가</button>
        </div>
      )}

      {error && <p className="ak-error" role="alert">{error}</p>}
      {notice && <p className="ak-notice" role="status">{notice}</p>}

      <DataTable
        columns={columns}
        hidden={EMPTY_HIDDEN}
        rows={pageRows}
        rowKey={(r) => r.key}
        limitRows
        emptyText="이 날짜에 배송비 줄이 없습니다. 터미널 관리에서 수단별 박스당 금액을 정해 두면 출고가 끝난 고객에게 제안됩니다."
      />

      {pageCount > 1 && (
        <div className="ak-toolbar" style={{ justifyContent: 'center' }}>
          <button className="ak-btn" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>이전 100줄</button>
          <span>{currentPage + 1} / {pageCount} 페이지</span>
          <button className="ak-btn" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>다음 100줄</button>
        </div>
      )}
    </>
  );
}
