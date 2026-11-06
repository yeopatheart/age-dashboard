'use client';
// 선택한 판매내역 줄로 영수증을 만드는 패널. 1) 어떤 영수증이 몇 장 만들어지는지 확인 → 2) 발행(스냅샷 저장) → 3) 영수증별 미리보기·이미지 저장·공유·복사.
import { useMemo, useState } from 'react';
import { SidePanel } from '@/components/admin/admin-kit';
import { ReceiptViewer } from '@/components/receipt/receipt-viewer';
import { formatWon } from '@/lib/money';
import { groupForReceipts, type ReceiptSkipReason, type ReceiptSourceRow } from '@/lib/settlement/receipt';
import type { SalesRow } from '@/lib/settlement/sales';
import { issueReceipts, type IssueResult } from './receipt-actions';

const SKIP_LABEL: Record<ReceiptSkipReason, string> = { 'no-seller': '사업자 구분 없음', 'no-price': '판매가 미입력' };

const toSource = (r: SalesRow): ReceiptSourceRow => ({
  itemId: r.itemId,
  orderDate: r.orderDate,
  customer: r.customer,
  product: r.product,
  quantity: r.quantity,
  unit: r.unit,
  sellerId: r.sellerId,
  price: r.price,
  unitPrice: r.unitPrice,
});

export function ReceiptIssuePanel({
  rows,
  sellers,
  from,
  to,
  saving,
  onClose,
}: {
  rows: SalesRow[]; // 선택한 줄(화면에서 고친 값이 반영된 것)
  sellers: { id: string; name: string }[];
  from: string;
  to: string;
  saving: boolean; // 판매가·사업자 저장이 끝나기 전에는 발행하지 않는다(서버가 저장된 값을 읽는다)
  onClose: () => void;
}) {
  const sellerName = useMemo(() => new Map(sellers.map((s) => [s.id, s.name])), [sellers]);
  const preview = useMemo(() => groupForReceipts(rows.map(toSource)), [rows]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await issueReceipts({ itemIds: rows.map((r) => r.itemId), from, to });
      if (res.error) setError(res.error);
      else {
        setResult(res);
        setOpenIndex(res.receipts.length === 1 ? 0 : null);
      }
    } catch {
      setError('영수증을 만들지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const skippedBySeller = rows.length - preview.groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <SidePanel
      title={result ? `영수증 ${result.receipts.length}장 발행됨` : '영수증 만들기'}
      width="min(34rem, 100%)"
      onClose={onClose}
      footer={
        result ? (
          <>
            <span className="ak-spacer" />
            <button className="ak-btn ak-btn-primary" onClick={onClose}>닫기</button>
          </>
        ) : (
          <>
            <span className="ak-spacer" />
            <button className="ak-btn" onClick={onClose} disabled={busy}>취소</button>
            <button className="ak-btn ak-btn-primary" onClick={issue} disabled={busy || saving || preview.groups.length === 0}>
              {busy ? '만드는 중…' : saving ? '저장 중…' : `영수증 ${preview.groups.length}장 발행`}
            </button>
          </>
        )
      }
    >
      {!result && (
        <>
          <p className="ak-meta">선택한 {rows.length}줄을 고객사 × 사업자 × 출고일로 묶어 영수증을 만듭니다. 발행하면 이력에 저장되고 이미지로 내려받거나 카카오톡으로 보낼 수 있습니다.</p>
          {preview.groups.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {preview.groups.map((g) => (
                <div key={g.key} className="ak-setting">
                  <span>
                    <strong>{g.customer}</strong>
                    <small>{g.orderDate} · {sellerName.get(g.sellerId) ?? '사업자'} · {g.rows.length}줄</small>
                  </span>
                  <strong>₩ {formatWon(g.rows.reduce((sum, r) => sum + r.price, 0))}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="ak-error">영수증으로 만들 수 있는 줄이 없습니다. 선택한 줄의 사업자 구분과 판매가를 먼저 입력해주세요.</p>
          )}
          {preview.skipped.length > 0 && (
            <div className="ak-error" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <strong>{skippedBySeller}줄은 영수증에 들어가지 않습니다.</strong>
              {(['no-seller', 'no-price'] as const).map((reason) => {
                const list = preview.skipped.filter((s) => s.reason === reason);
                if (list.length === 0) return null;
                const names = [...new Set(list.map((s) => s.row.customer))];
                return (
                  <span key={reason}>
                    {SKIP_LABEL[reason]} {list.length}줄 — {names.slice(0, 4).join(', ')}{names.length > 4 ? ` 외 ${names.length - 4}곳` : ''}
                  </span>
                );
              })}
            </div>
          )}
          {error && <p className="ak-error">{error}</p>}
        </>
      )}

      {result && (
        <>
          {(result.skipped.length > 0 || result.notFound > 0) && (
            <p className="ak-error">
              {result.skipped.length + result.notFound}줄은 영수증에 들어가지 않았습니다
              {result.notFound > 0 ? ' (그 사이 주문이 바뀐 줄이 있습니다. 화면을 새로고침해 확인해주세요)' : ''}.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {result.receipts.map((r, i) => (
              <div key={r.id || `${r.snapshot.orderDate}-${r.receiptNo}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div className="ak-setting" style={{ cursor: 'pointer' }} onClick={() => setOpenIndex(openIndex === i ? null : i)}>
                  <span>
                    <strong>NO. {r.receiptNo} · {r.snapshot.customerName}</strong>
                    <small>{r.snapshot.orderDate} · {r.snapshot.seller.name} · {r.snapshot.lines.length}줄 · ₩ {formatWon(r.snapshot.total)}</small>
                  </span>
                  <button type="button" className="ak-btn" onClick={(e) => { e.stopPropagation(); setOpenIndex(openIndex === i ? null : i); }}>
                    {openIndex === i ? '접기' : '이미지 보기'}
                  </button>
                </div>
                {/* 열린 영수증만 이미지를 만든다(여러 장을 한꺼번에 만들면 느리고 메모리를 많이 쓴다) */}
                {openIndex === i && <ReceiptViewer snapshot={r.snapshot} receiptNo={r.receiptNo} sealImage={result.seals[r.sellerId] ?? null} />}
              </div>
            ))}
          </div>
        </>
      )}
    </SidePanel>
  );
}
