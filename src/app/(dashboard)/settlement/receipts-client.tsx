'use client';
// 정산 "영수증" 구역: 조회 기간에 발행한 영수증 이력. 행을 누르면 영수증을 다시 열어 이미지로 저장·공유·복사하고, 잘못 발행한 것은 지울 수 있다.
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DataTable, SearchInput, SidePanel, type Column } from '@/components/admin/admin-kit';
import { useCan } from '@/components/permissions-context';
import { ReceiptViewer } from '@/components/receipt/receipt-viewer';
import { formatWon } from '@/lib/money';
import type { ReceiptRecord } from '@/lib/settlement/receipt-server';
import { deleteReceipt, loadReceiptSeal } from './receipt-actions';

const EMPTY_HIDDEN = new Set<string>();

// 발행 시각을 한국 시간 "MM.DD HH:mm"으로. 서버와 브라우저의 로캘 데이터 차이로 화면이 어긋나지 않게 직접 계산한다.
function formatIssuedAt(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString();
  return `${kst.slice(5, 7)}.${kst.slice(8, 10)} ${kst.slice(11, 16)}`;
}

// seal: undefined = 직인을 아직 불러오는 중, null = 직인 없음
type OpenReceipt = { receipt: ReceiptRecord; seal: string | null | undefined };

export function ReceiptsClient({ receipts, sellers }: { receipts: ReceiptRecord[]; sellers: { id: string; name: string }[] }) {
  const canDelete = useCan()('receipts:delete');
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [open, setOpen] = useState<OpenReceipt | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return receipts.filter((r) => (sellerFilter === '' || r.sellerId === sellerFilter) && (k === '' || r.customerName.toLowerCase().includes(k)));
  }, [receipts, search, sellerFilter]);
  const totalSum = filtered.reduce((sum, r) => sum + r.total, 0);

  // 영수증을 열 때 직인을 따로 받아 온다(이력 목록에는 용량이 큰 직인을 싣지 않는다). 직인이 올 때까지 이미지는 만들지 않는다.
  const openReceipt = (receipt: ReceiptRecord) => {
    setConfirmDelete(false);
    setError(null);
    setNotice(null);
    if (!receipt.snapshot) {
      setOpen({ receipt, seal: null });
      return;
    }
    setOpen({ receipt, seal: receipt.sellerId ? undefined : null });
    if (receipt.sellerId) {
      void loadReceiptSeal(receipt.sellerId)
        .then((res) => setOpen((cur) => (cur?.receipt.id === receipt.id ? { receipt, seal: res.seal } : cur)))
        .catch(() => setOpen((cur) => (cur?.receipt.id === receipt.id ? { receipt, seal: null } : cur)));
    }
  };

  const remove = async () => {
    if (!open || busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteReceipt(open.receipt.id).catch(() => ({ error: '삭제하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice(`NO. ${open.receipt.receiptNo} ${open.receipt.customerName} 영수증을 이력에서 삭제했습니다.`);
    setOpen(null);
    setConfirmDelete(false);
  };

  const columns: Column<ReceiptRecord>[] = [
    { key: 'date', label: '출고일', hideable: false, className: 'ak-fit', render: (r) => r.orderDate.slice(5).replace('-', '.') },
    { key: 'no', label: 'NO.', hideable: false, className: 'ak-fit', render: (r) => r.receiptNo },
    { key: 'customer', label: '고객명', hideable: false, render: (r) => <strong>{r.customerName}</strong> },
    { key: 'seller', label: '사업자', hideable: false, render: (r) => r.snapshot?.seller.name ?? <span className="ak-muted">-</span> },
    { key: 'lines', label: '품목', hideable: false, className: 'ak-fit', render: (r) => (r.snapshot ? `${r.snapshot.lines.length}줄` : '-') },
    { key: 'total', label: '합계(원)', hideable: false, className: 'ak-fit', render: (r) => formatWon(r.total) },
    { key: 'issued', label: '발행', hideable: false, className: 'ak-fit', render: (r) => formatIssuedAt(r.createdAt) },
  ];

  return (
    <>
      <div className="ak-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="고객명 검색" />
        <select className="ak-select" value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} aria-label="사업자 필터">
          <option value="">전체 사업자</option>
          {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="ak-count">{filtered.length}장</span>
        <span>합계 <strong>{formatWon(totalSum)}원</strong></span>
      </div>

      {notice && <p className="ak-notice" role="status">{notice}</p>}

      <DataTable
        columns={columns}
        hidden={EMPTY_HIDDEN}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={openReceipt}
        activeKey={open?.receipt.id ?? null}
        emptyText={receipts.length === 0 ? '이 기간에 발행한 영수증이 없습니다. 판매내역에서 줄을 선택해 “영수증 만들기”로 발행하세요.' : '조건에 맞는 영수증이 없습니다.'}
      />

      {open && (
        <SidePanel
          title={`NO. ${open.receipt.receiptNo} · ${open.receipt.customerName}`}
          width="min(34rem, 100%)"
          onClose={() => setOpen(null)}
          footer={
            confirmDelete ? (
              <>
                <span className="ak-error" style={{ flex: 1 }}>이력에서만 지워지고, 이미 저장하거나 보낸 이미지는 그대로입니다. 삭제할까요?</span>
                <button className="ak-btn" onClick={() => setConfirmDelete(false)} disabled={busy}>취소</button>
                <button className="ak-btn ak-btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={remove} disabled={busy}>삭제</button>
              </>
            ) : (
              <>
                {canDelete && <button className="ak-btn ak-btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> 삭제</button>}
                <span className="ak-spacer" />
                <button className="ak-btn" onClick={() => setOpen(null)}>닫기</button>
              </>
            )
          }
        >
          <p className="ak-meta">
            {open.receipt.orderDate} · 발행 {formatIssuedAt(open.receipt.createdAt)} · ₩ {formatWon(open.receipt.total)}
          </p>
          {error && <p className="ak-error" role="alert">{error}</p>}
          {!open.receipt.snapshot ? (
            <p className="ak-error" role="alert">이 영수증은 저장된 내용을 읽을 수 없어 열 수 없습니다.</p>
          ) : open.seal === undefined ? (
            <p className="ak-meta">직인을 불러오는 중…</p>
          ) : (
            <ReceiptViewer key={open.receipt.id} snapshot={open.receipt.snapshot} receiptNo={open.receipt.receiptNo} sealImage={open.seal} />
          )}
        </SidePanel>
      )}
    </>
  );
}
