'use client';
// 발행한 영수증 한 건의 미리보기와 이미지 저장·공유·복사. 15행을 넘으면 여러 장으로 나뉘어 장마다 버튼이 있다.
// 이미지는 화면이 열리자마자 미리 만들어 둔다 — 버튼을 누른 뒤에 만들면 오래 걸려서 모바일 공유 시트(사용자 동작 직후에만 열림)가 막힐 수 있다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Download, Share2 } from 'lucide-react';
import { pageNumberLabel, receiptFileName, splitPages, type ReceiptSnapshot } from '@/lib/settlement/receipt';
import { ReceiptSheet, RECEIPT_WIDTH_PX } from './receipt-sheet';
import { canCopyImage, canShareImage, copyImage, downloadBlob, receiptToPng, shareImage } from './receipt-image';

// 이 브라우저가 이미지 복사를 지원하는지. 서버 렌더에서는 항상 false라 화면이 어긋나지 않는다(하이드레이션 경고 방지).
const subscribeNothing = () => () => {};

// 브라우저가 던지는 영문 오류 문구 대신 사용자가 할 수 있는 조치를 알려 준다. 한글 문구는 그대로 쓴다.
function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return '브라우저가 이 동작을 허용하지 않았습니다. 주소창의 사이트 권한(클립보드·공유)을 확인해 주세요.';
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message;
  return fallback;
}

type PageImage = { state: 'pending' } | { state: 'ready'; blob: Blob } | { state: 'error'; message: string };

export function ReceiptViewer({ snapshot, receiptNo, sealImage }: { snapshot: ReceiptSnapshot; receiptNo: number; sealImage: string | null }) {
  const pages = useMemo(() => splitPages(snapshot.lines), [snapshot.lines]);
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [heights, setHeights] = useState<number[]>([]);
  const [images, setImages] = useState<PageImage[]>(() => pages.map(() => ({ state: 'pending' })));
  const [attempt, setAttempt] = useState(0); // 이미지 만들기에 실패했을 때 "다시 만들기"로 올린다
  const [message, setMessage] = useState<string | null>(null);
  const copySupported = useSyncExternalStore(subscribeNothing, canCopyImage, () => false);

  // 화면 폭에 맞춰 영수증을 줄여서 보여 준다(이미지는 줄이지 않은 원래 크기로 찍는다).
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(Math.min(1, frame.clientWidth / RECEIPT_WIDTH_PX));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setHeights(pages.map((_, i) => sheetRefs.current[i]?.offsetHeight ?? 0));
  }, [pages, sealImage]);

  // 장마다 차례로 이미지를 만들어 둔다(동시에 만들면 느리고 메모리를 많이 쓴다).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pages.length; i++) {
        const node = sheetRefs.current[i];
        if (!node) continue;
        try {
          const blob = await receiptToPng(node);
          if (cancelled) return;
          setImages((prev) => prev.map((img, j) => (j === i ? { state: 'ready', blob } : img)));
        } catch (e) {
          if (cancelled) return;
          const messageText = friendlyError(e, '이미지를 만들지 못했습니다. 다시 만들어 주세요.');
          setImages((prev) => prev.map((img, j) => (j === i ? { state: 'error', message: messageText } : img)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages, sealImage, attempt]);

  const fileName = (i: number) => receiptFileName(snapshot.orderDate, snapshot.customerName, i, pages.length);
  const run = async (fn: () => Promise<string | void>) => {
    setMessage(null);
    try {
      const done = await fn();
      if (done) setMessage(done);
    } catch (e) {
      setMessage(friendlyError(e, '실패했습니다. 다시 시도해주세요.'));
    }
  };

  const allReady = images.every((img) => img.state === 'ready');

  return (
    <div ref={frameRef} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p className="ak-meta">카카오톡으로 보내기 — 휴대폰: “카톡·공유”를 누르고 카카오톡을 고르세요. PC: “이미지 복사” 후 카카오톡 대화창에서 붙여넣기(Ctrl+V, Mac은 ⌘+V)하세요.</p>
      {pages.length > 1 && (
        <button
          type="button"
          className="ak-btn"
          disabled={!allReady}
          onClick={() =>
            void run(async () => {
              images.forEach((img, i) => img.state === 'ready' && downloadBlob(img.blob, fileName(i)));
              return `${pages.length}장을 저장했습니다.`;
            })
          }
        >
          <Download size={14} /> {pages.length}장 모두 저장
        </button>
      )}
      {pages.map((pageLines, i) => {
        const image = images[i];
        const ready = image?.state === 'ready' ? image.blob : null;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* 줄여서 보여 주는 틀: 안쪽 요소(sheetRefs)는 줄이지 않은 420px 그대로라 그것을 찍는다 */}
            <div style={{ height: (heights[i] ?? 0) * scale, overflow: 'hidden', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, background: '#fff' }}>
              <div style={{ width: RECEIPT_WIDTH_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <div ref={(el) => { sheetRefs.current[i] = el; }} style={{ width: RECEIPT_WIDTH_PX }}>
                  <ReceiptSheet
                    snapshot={snapshot}
                    pageLines={pageLines}
                    numberLabel={pageNumberLabel(receiptNo, i, pages.length)}
                    pageIndex={i}
                    pageCount={pages.length}
                    sealImage={sealImage}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="ak-btn ak-btn-primary" disabled={!ready} onClick={() => ready && void run(async () => { downloadBlob(ready, fileName(i)); return '이미지를 저장했습니다.'; })}>
                <Download size={14} /> 이미지 저장
              </button>
              {ready && canShareImage(ready, fileName(i)) && (
                <button type="button" className="ak-btn" onClick={() => void run(async () => ((await shareImage(ready, fileName(i))) === 'shared' ? '공유 시트로 보냈습니다.' : undefined))}>
                  <Share2 size={14} /> 카톡·공유
                </button>
              )}
              {copySupported && (
                <button type="button" className="ak-btn" disabled={!ready} onClick={() => ready && void run(async () => { await copyImage(ready); return '이미지를 복사했습니다. 카카오톡 채팅창에 붙여넣기(Ctrl+V)하세요.'; })}>
                  <Copy size={14} /> 이미지 복사
                </button>
              )}
              {image?.state === 'pending' && <span className="ak-meta">이미지 준비 중…</span>}
              {image?.state === 'error' && (
                <>
                  <span className="ak-error">{image.message}</span>
                  <button
                    type="button"
                    className="ak-btn"
                    onClick={() => {
                      setImages((prev) => prev.map((img, j) => (j === i ? { state: 'pending' } : img)));
                      setAttempt((n) => n + 1);
                    }}
                  >
                    다시 만들기
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {message && <p className="ak-notice">{message}</p>}
    </div>
  );
}
