'use client';
// 영수증 화면: 선택한 날짜에 발행한 영수증을 고객 단위 카드(줄인 영수증 그림)로 모아 보고, 카드의 "보내기"로 이미지를 카카오톡 등에 보낸다.
// 카드를 누르면 크게 보고, 잘못 발행한 것은 카드의 삭제로 이력에서 지운다(영수증 삭제 권한).
// 보내기 이미지는 카드가 화면에 보일 때 한 장씩 차례로 미리 만들어 둔다 — 눌린 뒤에 만들면 오래 걸려 모바일 공유 시트(사용자 동작 직후에만 열림)가 막힐 수 있고,
// 하루치를 한꺼번에 만들면 느리다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchInput, SidePanel } from '@/components/admin/admin-kit';
import { useCan } from '@/components/permissions-context';
import { ReceiptSheet, RECEIPT_WIDTH_PX } from '@/components/receipt/receipt-sheet';
import { canCopyImage, canShareImage, copyImage, downloadBlob, shareImage } from '@/components/receipt/receipt-image';
import { sentLabel, sentState, type SentEntry } from '@/lib/dispatch-log';
import { formatWon } from '@/lib/money';
import { pageNumberLabel, receiptFileName, splitPages } from '@/lib/settlement/receipt';
import type { ReceiptRecord } from '@/lib/settlement/receipt-server';
import { deleteReceipt } from '../settlement/receipt-actions';
import { useSentLog } from '../dispatch/use-sent-log';
import { ReceiptCard } from './receipt-card';
import { friendlyError, useReceiptImages, useReceiptSeals } from './use-receipt-images';

interface CardSpec {
  key: string;
  receipt: ReceiptRecord;
  pageIndex: number;
  pageCount: number;
}

// sent: 카드 키 → 가장 최근 보냄 기록(공유가 끝났거나 이미지를 복사한 순간). logEnabled=false면 기록하지 않는다(마이그레이션 0052 전).
// sentLog: 부모(보내기 화면의 고객사 탭)가 같은 기록 상태를 같이 쓰고 싶을 때 넘긴다. 없으면 이 화면이 자기 상태를 가진다.
export function ReceiptsClient({
  receipts,
  sellers,
  sent,
  logEnabled,
  sentLog,
}: {
  receipts: ReceiptRecord[];
  sellers: { id: string; name: string }[];
  sent: Record<string, SentEntry>;
  logEnabled: boolean;
  sentLog?: ReturnType<typeof useSentLog>;
}) {
  const ownLog = useSentLog('receipt', sent, logEnabled);
  const { entries: sentEntries, record, error: recordError } = sentLog ?? ownLog;
  const canDelete = useCan()('receipts:delete');
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [preview, setPreview] = useState<CardSpec | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    return receipts.filter((r) => (sellerFilter === '' || r.sellerId === sellerFilter) && (k === '' || r.customerName.toLowerCase().includes(k)));
  }, [receipts, search, sellerFilter]);
  const totalSum = filtered.reduce((sum, r) => sum + r.total, 0);

  // 영수증 한 장 = 카드 한 장. 줄이 많아 여러 장으로 나뉜 영수증은 장마다 카드다(보내는 이미지도 장마다다).
  const cards = useMemo<CardSpec[]>(
    () =>
      filtered.flatMap((receipt) => {
        if (!receipt.snapshot) return [];
        const pageCount = splitPages(receipt.snapshot.lines).length;
        return Array.from({ length: pageCount }, (_, pageIndex) => ({ key: `${receipt.id}:${pageIndex}`, receipt, pageIndex, pageCount }));
      }),
    [filtered],
  );
  const unreadable = filtered.filter((r) => !r.snapshot).length;

  // 보이는 영수증의 사업자 직인을 한 번씩 받아 온다(이력 목록에는 용량이 큰 직인을 싣지 않는다).
  const sellerIds = useMemo(() => [...new Set(filtered.filter((r) => r.snapshot && r.sellerId).map((r) => r.sellerId as string))], [filtered]);
  const seals = useReceiptSeals(sellerIds);
  const { images, registerNode, want, retry } = useReceiptImages(seals);
  const sealOf = (r: ReceiptRecord): string | null | undefined => (r.sellerId ? seals[r.sellerId] : null);

  // 카드가 화면 근처에 들어오면 이미지를 만들 목록에 넣는다.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.cardKey as string);
        if (seen.length > 0) want(seen);
      },
      { rootMargin: '300px' },
    );
    grid.querySelectorAll('[data-card-key]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [cards, seals, want]);

  const flash = (message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  const send = async (spec: CardSpec) => {
    const image = images[spec.key];
    if (image?.state === 'error') {
      retry(spec.key); // 다시 만들기: 실패 기록을 지우면 만들 목록에서 다시 차례가 온다
      return;
    }
    if (image?.state !== 'ready' || busyKey) return;
    const { receipt, pageIndex, pageCount } = spec;
    const name = receiptFileName(receipt.orderDate, receipt.customerName, pageIndex, pageCount);
    setError(null);
    setBusyKey(spec.key);
    try {
      if (canShareImage(image.blob, name)) {
        if ((await shareImage(image.blob, name)) === 'shared') {
          flash(`${receipt.customerName} 영수증을 공유 시트로 보냈습니다.`);
          await record(receipt.orderDate, spec.key, 'share', null);
        }
      } else if (canCopyImage()) {
        await copyImage(image.blob);
        flash(`${receipt.customerName} 영수증 이미지를 복사했습니다. 카카오톡 채팅창에 붙여넣기(Ctrl+V, Mac은 ⌘+V)하세요.`);
        await record(receipt.orderDate, spec.key, 'copy', null); // 파일로 저장만 한 경우는 보냈는지 알 수 없어 기록하지 않는다
      } else {
        downloadBlob(image.blob, name);
        flash(`${receipt.customerName} 영수증 이미지를 저장했습니다.`);
      }
    } catch (e) {
      setError(friendlyError(e, '보내지 못했습니다. 다시 시도해주세요.'));
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (spec: CardSpec) => {
    if (busyKey) return;
    setBusyKey(spec.key);
    setError(null);
    const result = await deleteReceipt(spec.receipt.id).catch(() => ({ error: '삭제하지 못했습니다. 권한이나 연결을 확인한 뒤 다시 시도해주세요.' }));
    setBusyKey(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setConfirmKey(null);
    flash(`NO. ${spec.receipt.receiptNo} ${spec.receipt.customerName} 영수증을 이력에서 삭제했습니다.`);
  };

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
      {error && <p className="ak-error" role="alert">{error}</p>}
      {recordError && <p className="ak-error" role="alert">{recordError}</p>}
      {unreadable > 0 && <p className="ak-error">저장된 내용을 읽을 수 없는 영수증이 {unreadable}장 있어 표시하지 못했습니다.</p>}

      {filtered.length === 0 ? (
        <p className="ak-muted">{receipts.length === 0 ? '이 날짜에 발행한 영수증이 없습니다. 정산 판매내역에서 줄을 선택해 “영수증 만들기”로 발행하세요.' : '조건에 맞는 영수증이 없습니다.'}</p>
      ) : (
        <div className="rc-grid-wrap">
          <div className="rc-grid" ref={gridRef}>
            {cards.map((spec) => {
              const seal = sealOf(spec.receipt);
              if (seal === undefined || !spec.receipt.snapshot) return <div key={spec.key} className="rc-card rc-skeleton" data-card-key={spec.key} aria-busy />;
              const pages = splitPages(spec.receipt.snapshot.lines);
              return (
                <ReceiptCard
                  key={spec.key}
                  cardKey={spec.key}
                  snapshot={spec.receipt.snapshot}
                  receiptNo={spec.receipt.receiptNo}
                  pageLines={pages[spec.pageIndex]}
                  pageIndex={spec.pageIndex}
                  pageCount={spec.pageCount}
                  sealImage={seal}
                  image={images[spec.key] ?? { state: 'pending' }}
                  canDelete={canDelete}
                  confirming={confirmKey === spec.key}
                  busy={busyKey === spec.key}
                  sentText={sentLabel(sentEntries[spec.key], sentState(sentEntries[spec.key]))}
                  registerNode={registerNode}
                  onOpen={() => setPreview(spec)}
                  onSend={() => void send(spec)}
                  onAskDelete={() => setConfirmKey(spec.key)}
                  onCancelDelete={() => setConfirmKey(null)}
                  onDelete={() => void remove(spec)}
                />
              );
            })}
          </div>
        </div>
      )}

      {preview && preview.receipt.snapshot && (
        <SidePanel title={`NO. ${preview.receipt.receiptNo} · ${preview.receipt.customerName}`} width="min(34rem, 100%)" onClose={() => setPreview(null)} footer={<><span className="ak-spacer" /><button className="ak-btn" onClick={() => setPreview(null)}>닫기</button></>}>
          <p className="ak-meta">{preview.receipt.orderDate} · ₩ {formatWon(preview.receipt.total)}</p>
          <PreviewSheet spec={preview} seal={sealOf(preview.receipt) ?? null} />
        </SidePanel>
      )}

      <style>{`
        .rc-grid-wrap { container-type: inline-size; min-width: 0; }
        .rc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; align-items: start; }
        @container (min-width: 420px) { .rc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @container (min-width: 600px) { .rc-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
        @container (min-width: 860px) { .rc-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
        .rc-card { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.45rem; box-shadow: var(--shadow-sm); }
        .rc-skeleton { min-height: 12rem; background: #f1f5f9; }
        .rc-thumb { display: block; width: 100%; overflow: hidden; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: #fff; cursor: zoom-in; text-align: left; }
        .rc-meta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; padding: 0 0.1rem; }
        .rc-name { font-size: var(--fs-md); font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rc-sub { font-size: var(--fs-xs); color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rc-actions { display: flex; gap: 0.35rem; }
        .rc-send { flex: 1; justify-content: center; min-width: 0; }
        .rc-del { flex: none; width: var(--ctl-h); padding: 0; justify-content: center; color: var(--danger); }
        .rc-confirm { display: flex; flex-direction: column; gap: 0.4rem; font-size: var(--fs-xs); font-weight: 700; color: var(--danger); }
        .rc-confirm .rc-actions .ak-btn { flex: 1; justify-content: center; padding: 0 0.4rem; }
      `}</style>
    </>
  );
}

// 크게 보기: 패널 폭에 맞춰 줄인 영수증(해당 장). 여러 장짜리면 누른 장만 보인다.
function PreviewSheet({ spec, seal }: { spec: CardSpec; seal: string | null }) {
  const snapshot = spec.receipt.snapshot;
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [naturalH, setNaturalH] = useState(0);
  const lines = useMemo(() => (snapshot ? splitPages(snapshot.lines)[spec.pageIndex] : []), [snapshot, spec.pageIndex]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      setScale(Math.min(1, frame.clientWidth / RECEIPT_WIDTH_PX));
      setNaturalH(sheetRef.current?.offsetHeight ?? 0);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [seal]);
  if (!snapshot) return null;
  return (
    <div ref={frameRef} style={{ width: '100%' }}>
      <div style={{ height: naturalH * scale, overflow: 'hidden', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, background: '#fff' }}>
        <div style={{ width: RECEIPT_WIDTH_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div ref={sheetRef} style={{ width: RECEIPT_WIDTH_PX }}>
            <ReceiptSheet snapshot={snapshot} pageLines={lines} numberLabel={pageNumberLabel(spec.receipt.receiptNo, spec.pageIndex, spec.pageCount)} pageIndex={spec.pageIndex} pageCount={spec.pageCount} sealImage={seal} />
          </div>
        </div>
      </div>
    </div>
  );
}
