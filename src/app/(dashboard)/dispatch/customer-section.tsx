'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Eye, MessageSquareText, Receipt as ReceiptIcon } from 'lucide-react';
import { SidePanel } from '@/components/admin/admin-kit';
import { canCopyImage, canShareImages, copyImage, shareImages } from '@/components/receipt/receipt-image';
import { ReceiptSheet, RECEIPT_WIDTH_PX } from '@/components/receipt/receipt-sheet';
import { MigrationNotice } from '@/components/migration-notice';
import { buildCustomerMessage, groupSettledCustomers, type MessageRow } from '@/lib/customer-message';
import { hashText, sentLabel, sentState, type SentEntry } from '@/lib/dispatch-log';
import { formatWon } from '@/lib/money';
import { cleanShareText } from '@/lib/share-text';
import { pageNumberLabel, receiptFileName, splitPages } from '@/lib/settlement/receipt';
import type { ReceiptRecord } from '@/lib/settlement/receipt-server';
import { useShareText } from '@/lib/use-share-text';
import { ReceiptsClient } from '../receipts/receipts-client';
import { friendlyError, useReceiptImages, useReceiptSeals } from '../receipts/use-receipt-images';
import { useSentLog } from './use-sent-log';

interface CardKey {
  key: string;
  receipt: ReceiptRecord;
  pageIndex: number;
  pageCount: number;
}

// 고객사 구역: 그날 정산이 끝난(모든 줄에 판매가가 입력된) 고객사를 올리고, 업체마다
//  - 메세지 보내기: 정산 내역 글(품목·금액·합계)을 공유 시트로(없으면 복사). 주로 쓰는 기능이라 가장 크게 둔다.
//  - 영수증 보내기: 발행된 영수증 이미지를 보낸다(일부 업체만). 여러 장이면 모바일은 한 번에, 컴퓨터는 미리보기에서 장별로.
//  - 영수증 미리보기: 옆 패널에서 영수증을 확인하고 보내거나 삭제한다(영수증 화면과 같은 카드).
// 영수증 이미지는 업체 줄이 화면 근처에 오면 안 보이는 곳에 영수증을 그려서 미리 만든다(보내기를 누른 뒤에 만들면 모바일 공유 시트가 막힌다).
export function CustomerSection({
  orderDate,
  rows,
  receipts,
  sellers,
  canReceipts,
  receiptsMissing,
  sentMessage,
  sentReceipt,
  logEnabled,
}: {
  orderDate: string;
  rows: MessageRow[];
  receipts: ReceiptRecord[]; // 그날 발행한 영수증(영수증 보기 권한이 없으면 빈 배열)
  sellers: { id: string; name: string }[];
  canReceipts: boolean;
  receiptsMissing: string[] | null;
  sentMessage: Record<string, SentEntry>; // 고객명 → 가장 최근 메시지 보냄 기록
  sentReceipt: Record<string, SentEntry>; // 영수증 카드 키 → 가장 최근 보냄 기록
  logEnabled: boolean;
}) {
  const { settled, pending } = useMemo(() => groupSettledCustomers(rows), [rows]);
  const { canShare, copiedKey, copy, share } = useShareText();
  const messageLog = useSentLog('customer', sentMessage, logEnabled);
  const receiptLog = useSentLog('receipt', sentReceipt, logEnabled);

  // 고객명 → 그 고객사의 영수증 카드(영수증 한 장이 15행을 넘으면 장마다 카드)
  const cardsByCustomer = useMemo(() => {
    const map = new Map<string, CardKey[]>();
    for (const receipt of receipts) {
      if (!receipt.snapshot) continue;
      const pageCount = splitPages(receipt.snapshot.lines).length;
      const list = map.get(receipt.customerName) ?? [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) list.push({ key: `${receipt.id}:${pageIndex}`, receipt, pageIndex, pageCount });
      map.set(receipt.customerName, list);
    }
    return map;
  }, [receipts]);

  const sellerIds = useMemo(() => [...new Set(receipts.filter((r) => r.snapshot && r.sellerId).map((r) => r.sellerId as string))], [receipts]);
  const seals = useReceiptSeals(sellerIds);
  const { images, registerNode, want, retry } = useReceiptImages(seals);

  // 업체 줄이 화면 근처에 처음 오면 그 업체의 영수증 이미지를 만들기 시작한다.
  const [visible, setVisible] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !canReceipts) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.customer as string);
        if (seen.length === 0) return;
        setVisible((prev) => [...prev, ...seen.filter((c) => !prev.includes(c))]);
        want(seen.flatMap((c) => (cardsByCustomer.get(c) ?? []).map((card) => card.key)));
      },
      { rootMargin: '300px' },
    );
    list.querySelectorAll('[data-customer]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [settled, canReceipts, cardsByCustomer, want]);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const flash = (message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  const sendMessage = async (customer: string, text: string) => {
    const hash = hashText(cleanShareText(text));
    if (canShare) {
      const result = await share(customer, text);
      if (result !== 'none') await messageLog.record(orderDate, customer, result === 'shared' ? 'share' : 'copy', hash);
    } else if (await copy(customer, text)) {
      await messageLog.record(orderDate, customer, 'copy', hash);
    }
  };

  // 영수증 이미지 준비 상태: 영수증 없음 / 준비 중 / 실패 / 준비됨
  const receiptState = (customer: string): 'none' | 'preparing' | 'error' | 'ready' => {
    const cards = cardsByCustomer.get(customer);
    if (!cards || cards.length === 0) return 'none';
    const states = cards.map((c) => images[c.key]?.state ?? 'pending');
    if (states.includes('error')) return 'error';
    return states.every((s) => s === 'ready') ? 'ready' : 'preparing';
  };

  const sendReceipts = async (customer: string) => {
    const cards = cardsByCustomer.get(customer) ?? [];
    const state = receiptState(customer);
    if (state === 'error') {
      for (const c of cards) if (images[c.key]?.state === 'error') retry(c.key);
      return;
    }
    if (state !== 'ready' || busy) return;
    const items = cards.map((c) => ({ card: c, blob: (images[c.key] as { state: 'ready'; blob: Blob }).blob, name: receiptFileName(c.receipt.orderDate, c.receipt.customerName, c.pageIndex, c.pageCount) }));
    setError(null);
    setBusy(customer);
    try {
      if (canShareImages(items)) {
        if ((await shareImages(items)) === 'shared') {
          flash(`${customer} 영수증 ${items.length}장을 공유 시트로 보냈습니다.`);
          for (const i of items) await receiptLog.record(i.card.receipt.orderDate, i.card.key, 'share', null);
        }
      } else if (items.length === 1 && canCopyImage()) {
        await copyImage(items[0].blob);
        flash(`${customer} 영수증 이미지를 복사했습니다. 카카오톡 채팅창에 붙여넣기(Ctrl+V, Mac은 ⌘+V)하세요.`);
        await receiptLog.record(items[0].card.receipt.orderDate, items[0].card.key, 'copy', null);
      } else {
        setPanel(customer);
        flash('이 기기에서는 영수증을 한 장씩 보내야 합니다. 미리보기에서 장마다 보내기를 누르세요.');
      }
    } catch (e) {
      setError(friendlyError(e, '보내지 못했습니다. 다시 시도해주세요.'));
    } finally {
      setBusy(null);
    }
  };

  const panelReceipts = useMemo(() => (panel ? receipts.filter((r) => r.customerName === panel) : []), [panel, receipts]);

  if (settled.length === 0 && pending.length === 0) {
    return <p className="ak-muted">이 날짜의 정산 판매내역이 없습니다. 출고가 끝난 주문이 있어야 정산 화면에 올라옵니다.</p>;
  }

  return (
    <>
      {receiptsMissing && <MigrationNotice feature="영수증" migrations={receiptsMissing} />}
      {settled.length === 0 && <p className="ak-muted">정산이 끝난 고객사가 없습니다. 정산 판매내역에서 모든 줄의 판매가를 입력하면 여기에 나타납니다.</p>}
      <ul className="cs-list" ref={listRef}>
        {settled.map((c) => {
          const text = buildCustomerMessage(orderDate, c);
          const entry = messageLog.entries[c.customer];
          const state = sentState(entry, hashText(cleanShareText(text)));
          const label = sentLabel(entry, state);
          const cards = cardsByCustomer.get(c.customer) ?? [];
          const rState = canReceipts ? receiptState(c.customer) : 'none';
          const receiptSent = cards.length > 0 && cards.every((card) => receiptLog.entries[card.key]);
          const lastReceipt = receiptSent ? cards.map((card) => receiptLog.entries[card.key]).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))[0] : undefined;
          const receiptLabel = lastReceipt ? sentLabel(lastReceipt, 'sent') : null;
          return (
            <li key={c.customer} className="cs-card" data-customer={c.customer}>
              <div className="cs-head">
                <button type="button" className="cs-name" onClick={() => setExpanded((cur) => (cur === c.customer ? null : c.customer))} aria-expanded={expanded === c.customer} title="보낼 글 보기">
                  <strong>{c.customer}</strong>
                  <span className="cs-sum">₩{formatWon(c.total)} · {c.rows.length}줄</span>
                </button>
                <div className="cs-icons">
                  <button type="button" className="cs-icon cs-icon-primary" onClick={() => void sendMessage(c.customer, text)} aria-label={`${c.customer} 메세지 보내기`} title={canShare ? '메세지 보내기' : '메세지 복사(컴퓨터에서는 공유 시트가 없어 복사합니다)'}>
                    {!canShare && copiedKey === c.customer ? <Check size={22} /> : canShare ? <MessageSquareText size={22} /> : <Copy size={22} />}
                  </button>
                  {canReceipts && (
                    <>
                      <button
                        type="button"
                        className={`cs-icon ${rState === 'error' ? 'cs-icon-warn' : ''}`}
                        onClick={() => void sendReceipts(c.customer)}
                        disabled={rState === 'none' || rState === 'preparing' || busy === c.customer}
                        aria-label={`${c.customer} 영수증 보내기`}
                        title={rState === 'none' ? '발행된 영수증이 없습니다' : rState === 'preparing' ? '영수증 이미지 준비 중…' : rState === 'error' ? '이미지를 만들지 못했습니다. 눌러서 다시 만들기' : '영수증 보내기'}
                      >
                        <ReceiptIcon size={22} />
                      </button>
                      <button type="button" className="cs-icon" onClick={() => setPanel(c.customer)} disabled={cards.length === 0} aria-label={`${c.customer} 영수증 미리보기`} title={cards.length === 0 ? '발행된 영수증이 없습니다' : '영수증 미리보기·삭제'}>
                        <Eye size={22} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {(label || cards.length > 0) && (
                <div className="cs-tags">
                  {label && <span className={`cs-tag ${state === 'changed' ? 'cs-tag-warn' : 'cs-tag-sent'}`}>메세지 {label}</span>}
                  {canReceipts && cards.length > 0 && <span className="cs-tag">영수증 {new Set(cards.map((x) => x.receipt.id)).size}장</span>}
                  {receiptLabel && <span className="cs-tag cs-tag-sent">영수증 {receiptLabel}</span>}
                </div>
              )}
              {expanded === c.customer && <pre className="cs-text">{text}</pre>}
              {canReceipts && visible.includes(c.customer) && cards.length > 0 && (
                <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
                  {cards.map((card) => {
                    const seal = card.receipt.sellerId ? seals[card.receipt.sellerId] : null;
                    const snapshot = card.receipt.snapshot;
                    if (seal === undefined || !snapshot) return null;
                    return (
                      <HiddenSheet
                        key={card.key}
                        cardKey={card.key}
                        registerNode={registerNode}
                        sheet={<ReceiptSheet snapshot={snapshot} pageLines={splitPages(snapshot.lines)[card.pageIndex]} numberLabel={pageNumberLabel(card.receipt.receiptNo, card.pageIndex, card.pageCount)} pageIndex={card.pageIndex} pageCount={card.pageCount} sealImage={seal} />}
                      />
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {pending.length > 0 && <p className="ak-muted">정산 미완료 {pending.length}곳(판매가 미입력): {pending.join(', ')}</p>}
      {notice && <p className="ak-muted" role="status">{notice}</p>}
      {error && <p className="ak-error" role="alert">{error}</p>}
      {messageLog.error && <p className="ak-error" role="alert">{messageLog.error}</p>}

      {panel && (
        <SidePanel title={`${panel} 영수증`} width="min(40rem, 100%)" onClose={() => setPanel(null)} footer={<><span className="ak-spacer" /><button className="ak-btn" onClick={() => setPanel(null)}>닫기</button></>}>
          {panelReceipts.length === 0 ? <p className="ak-muted">발행된 영수증이 없습니다.</p> : <ReceiptsClient key={panel} receipts={panelReceipts} sellers={sellers} sent={sentReceipt} logEnabled={logEnabled} sentLog={receiptLog} />}
        </SidePanel>
      )}

      <style>{`
        .cs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-inner); }
        .cs-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: var(--space-inner); min-width: 0; }
        .cs-head { display: flex; align-items: center; gap: 0.5rem; }
        .cs-name { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; cursor: pointer; }
        .cs-name strong { font-size: var(--fs-lg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cs-sum { font-size: var(--fs-sm); color: var(--muted-foreground, #64748b); font-weight: 700; }
        .cs-icons { display: flex; gap: 0.5rem; flex: none; }
        .cs-icon { display: inline-flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--foreground); cursor: pointer; }
        .cs-icon-primary { width: 3.25rem; height: 3.25rem; background: var(--primary); border-color: var(--primary); color: #fff; }
        .cs-icon-warn { border-color: #f59e0b; color: #b45309; }
        .cs-icon:disabled { opacity: 0.4; cursor: not-allowed; }
        .cs-tags { display: flex; gap: 0.4rem; flex-wrap: wrap; }
        .cs-tag { font-size: var(--fs-xs); font-weight: 800; border-radius: 999px; padding: 0.15rem 0.6rem; background: #f1f5f9; color: #475569; }
        .cs-tag-sent { background: #e0f2fe; color: #0369a1; }
        .cs-tag-warn { background: #fef3c7; color: #b45309; }
        .cs-text { margin: 0; padding: 0.6rem 0.8rem; background: #f8fafc; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; font-size: var(--fs-md); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
      `}</style>
    </>
  );
}

// 이미지로 찍을 영수증 요소를 화면 밖에 그려 두고 찍을 수 있게 등록한다(영수증 카드와 같은 원래 크기).
function HiddenSheet({ cardKey, registerNode, sheet }: { cardKey: string; registerNode: (key: string, node: HTMLElement | null) => void; sheet: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    registerNode(cardKey, ref.current);
    return () => registerNode(cardKey, null);
  }, [cardKey, registerNode]);
  return (
    <div ref={ref} style={{ width: RECEIPT_WIDTH_PX }}>
      {sheet}
    </div>
  );
}
