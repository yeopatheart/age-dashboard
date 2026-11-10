'use client';
import { useMemo } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { terminalShareList } from '@/lib/scan-share-text';
import type { ScanShareTemplate } from '@/lib/scan-share-template';
import { useShareText } from '@/lib/use-share-text';
import type { ScanCard } from '../scan/scan-client';

// 기사 구역: 터미널마다 퀵 기사님께 보낼 상차 완료 글(상차 스캔 화면과 같은 글·같은 설정)과 보내기 버튼.
// 상차된 박스가 하나도 없는 터미널은 보낼 글이 없다. 일부만 상차했으면 글 끝에 "⚠ 미상차" 줄이 붙는다(글 형식은 시스템 설정).
export function DriverSection({ orderDate, cards, shareTemplate }: { orderDate: string; cards: ScanCard[]; shareTemplate: ScanShareTemplate }) {
  const terminals = useMemo(() => terminalShareList(orderDate, cards, shareTemplate), [orderDate, cards, shareTemplate]);
  const { canShare, copiedKey, copy, share } = useShareText();

  if (terminals.length === 0) {
    return <p className="ak-muted">이 날짜에 라벨을 출력한 업체가 없습니다. 박스 할당 화면에서 라벨을 출력하고 상차 스캔을 하면 여기에 나타납니다.</p>;
  }

  return (
    <>
      <ul className="dd-list">
        {terminals.map((t) => (
          <li key={t.name} className={`dd-card ${t.total > 0 && t.loaded === t.total ? 'dd-done' : ''}`}>
            <div className="dd-head">
              <strong className="dd-name">{t.name}</strong>
              <span className="dd-count">{t.loaded}/{t.total}박스</span>
              {t.loaded === t.total && <span className="dd-tag">상차 완료</span>}
            </div>
            {t.text ? (
              <>
                <pre className="dd-text">{t.text}</pre>
                <div className="dd-actions">
                  {canShare && (
                    <button type="button" className="dd-btn dd-btn-primary" onClick={() => share(t.name, t.text!)}>
                      <Share2 size={15} /> 보내기
                    </button>
                  )}
                  <button type="button" className={`dd-btn ${canShare ? '' : 'dd-btn-primary'}`} onClick={() => copy(t.name, t.text!)}>
                    {copiedKey === t.name ? <Check size={15} /> : <Copy size={15} />} {copiedKey === t.name ? '복사됨' : '복사'}
                  </button>
                </div>
              </>
            ) : (
              <p className="dd-empty">상차된 박스가 없어 보낼 글이 없습니다.</p>
            )}
          </li>
        ))}
      </ul>

        <style>{`
          .dd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-inner); }
          .dd-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: var(--space-inner); min-width: 0; }
          .dd-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
          .dd-name { font-size: var(--fs-lg); }
          .dd-count { font-size: var(--fs-sm); color: var(--muted-foreground, #64748b); font-weight: 700; }
          .dd-tag { font-size: var(--fs-xs); font-weight: 800; border-radius: 999px; padding: 0.15rem 0.6rem; background: #dcfce7; color: #15803d; }
          .dd-text { margin: 0; padding: 0.6rem 0.8rem; background: #f8fafc; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; font-size: var(--fs-md); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
          .dd-actions { display: flex; gap: 0.5rem; }
          .dd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; height: var(--ctl-h); padding: 0 1rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--foreground); font-size: var(--fs-sm); font-weight: 800; cursor: pointer; white-space: nowrap; }
          .dd-btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
          .dd-empty { margin: 0; font-size: var(--fs-sm); color: var(--muted-foreground, #64748b); }
          @media (max-width: 768px) { .dd-btn { height: var(--cta-h); flex: 1; font-size: var(--fs-md); } }
        `}</style>
    </>
  );
}
