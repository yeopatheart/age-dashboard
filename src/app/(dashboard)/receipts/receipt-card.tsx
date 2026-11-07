'use client';
// 영수증 한 장(15행을 넘으면 장마다)을 카드로 보여 준다: 줄인 영수증 그림 + 고객명 + 보내기(+삭제). 그림은 영수증 화면 요소를 그대로 줄여 그린 것이고,
// 보내기에 쓰는 이미지(PNG)는 부모(receipts-client)가 카드가 화면에 보일 때 차례로 만들어 blob으로 넘겨 준다.
import { useLayoutEffect, useRef, useState } from 'react';
import { Share2, Trash2 } from 'lucide-react';
import { ReceiptSheet, RECEIPT_WIDTH_PX } from '@/components/receipt/receipt-sheet';
import { formatWon } from '@/lib/money';
import { pageNumberLabel, type ReceiptLine, type ReceiptSnapshot } from '@/lib/settlement/receipt';

export type CardImage = { state: 'pending' } | { state: 'ready'; blob: Blob } | { state: 'error'; message: string };

export function ReceiptCard({
  cardKey,
  snapshot,
  receiptNo,
  pageLines,
  pageIndex,
  pageCount,
  sealImage,
  image,
  canDelete,
  confirming,
  busy,
  registerNode,
  onOpen,
  onSend,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  cardKey: string;
  snapshot: ReceiptSnapshot;
  receiptNo: number;
  pageLines: ReceiptLine[];
  pageIndex: number;
  pageCount: number;
  sealImage: string | null; // 직인(없으면 null). 아직 불러오는 중이면 카드를 그리지 않는다
  image: CardImage;
  canDelete: boolean;
  confirming: boolean; // 삭제 확인 중
  busy: boolean; // 보내는 중·삭제하는 중
  registerNode: (key: string, node: HTMLElement | null) => void;
  onOpen: () => void;
  onSend: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const frameRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [naturalH, setNaturalH] = useState(0);

  // 카드 폭에 맞춰 영수증을 줄여서 보여 준다(이미지는 줄이지 않은 원래 크기로 찍는다 — receipt-image.ts).
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(frame.clientWidth / RECEIPT_WIDTH_PX);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    setNaturalH(sheetRef.current?.offsetHeight ?? 0);
  }, [sealImage, pageLines]);
  useLayoutEffect(() => {
    registerNode(cardKey, sheetRef.current);
    return () => registerNode(cardKey, null);
  }, [cardKey, registerNode]);

  const label = pageCount > 1 ? `${snapshot.customerName} (${pageIndex + 1}/${pageCount})` : snapshot.customerName;
  const ready = image.state === 'ready';

  return (
    <article className="rc-card" data-card-key={cardKey}>
      <button ref={frameRef} type="button" className="rc-thumb" style={{ height: naturalH * scale }} onClick={onOpen} aria-label={`${label} 영수증 크게 보기`}>
        <div style={{ width: RECEIPT_WIDTH_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div ref={sheetRef} style={{ width: RECEIPT_WIDTH_PX }}>
            <ReceiptSheet snapshot={snapshot} pageLines={pageLines} numberLabel={pageNumberLabel(receiptNo, pageIndex, pageCount)} pageIndex={pageIndex} pageCount={pageCount} sealImage={sealImage} />
          </div>
        </div>
      </button>
      <div className="rc-meta">
        <strong className="rc-name" title={label}>{label}</strong>
        <span className="rc-sub">NO. {receiptNo} · {snapshot.seller.name} · ₩{formatWon(snapshot.total)}</span>
      </div>
      {confirming ? (
        <div className="rc-confirm">
          <span>이력에서만 지워집니다. 삭제할까요?</span>
          <div className="rc-actions">
            <button type="button" className="ak-btn" onClick={onCancelDelete} disabled={busy}>취소</button>
            <button type="button" className="ak-btn ak-btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={onDelete} disabled={busy}>삭제</button>
          </div>
        </div>
      ) : (
        <div className="rc-actions">
          <button type="button" className="ak-btn ak-btn-primary rc-send" onClick={onSend} disabled={image.state === 'pending' || busy} title={image.state === 'error' ? image.message : undefined}>
            {ready && <Share2 size={14} />}
            {image.state === 'error' ? '다시 만들기' : ready ? '보내기' : '준비 중…'}
          </button>
          {canDelete && (
            <button type="button" className="ak-btn rc-del" onClick={onAskDelete} disabled={busy} aria-label={`${label} 영수증 삭제`} title="삭제">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
