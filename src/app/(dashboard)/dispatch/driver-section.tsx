'use client';
import { useMemo } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { hashText, sentLabel, sentState, type SentEntry } from '@/lib/dispatch-log';
import { cleanShareText } from '@/lib/share-text';
import { terminalShareList } from '@/lib/scan-share-text';
import type { ScanShareTemplate } from '@/lib/scan-share-template';
import { useShareText } from '@/lib/use-share-text';
import type { ScanCard } from '../scan/scan-client';
import { useSentLog } from './use-sent-log';

// 퀵기사 구역: 터미널마다 퀵 기사님께 보낼 상차 완료 글(상차 스캔 화면과 같은 글·같은 설정)과 보내기 버튼.
// 상차된 박스가 하나도 없는 터미널은 보낼 글이 없다. 일부만 상차했으면 글 끝에 "⚠ 미상차" 줄이 붙는다(글 형식은 시스템 설정).
// 공유가 끝났거나 복사에 성공하면 보냄 기록(dispatch_log)을 남기고 카드에 "보냄 ✓ 시각"을 보인다. 보낸 뒤 글이 달라지면(상차가 더 됨 등) "이후 변경됨"으로 바뀐다.
export function DriverSection({
  orderDate,
  cards,
  shareTemplate,
  sent,
  logEnabled,
}: {
  orderDate: string;
  cards: ScanCard[];
  shareTemplate: ScanShareTemplate;
  sent: Record<string, SentEntry>; // 터미널 이름 → 가장 최근 보냄 기록
  logEnabled: boolean; // 마이그레이션 0052 적용 여부
}) {
  const terminals = useMemo(() => terminalShareList(orderDate, cards, shareTemplate), [orderDate, cards, shareTemplate]);
  const { canShare, copiedKey, copy, share } = useShareText();
  const { entries, record, error } = useSentLog('driver', sent, logEnabled);

  const onShare = async (name: string, text: string) => {
    const result = await share(name, text);
    if (result !== 'none') await record(orderDate, name, result === 'shared' ? 'share' : 'copy', hashText(cleanShareText(text)));
  };
  const onCopy = async (name: string, text: string) => {
    if (await copy(name, text)) await record(orderDate, name, 'copy', hashText(cleanShareText(text)));
  };

  if (terminals.length === 0) {
    return <p className="ak-muted">이 날짜에 라벨을 출력한 업체가 없습니다. 박스 할당 화면에서 라벨을 출력하고 상차 스캔을 하면 여기에 나타납니다.</p>;
  }

  return (
    <>
      <ul className="dd-list">
        {terminals.map((t) => {
          const entry = entries[t.name];
          const state = sentState(entry, t.text ? hashText(cleanShareText(t.text)) : undefined);
          const label = sentLabel(entry, state);
          return (
          <li key={t.name} className={`dd-card ${t.total > 0 && t.loaded === t.total ? 'dd-done' : ''}`}>
            <div className="dd-head">
              <strong className="dd-name">{t.name}</strong>
              <span className="dd-count">{t.loaded}/{t.total}박스</span>
              {t.loaded === t.total && <span className="dd-tag">상차 완료</span>}
              {label && <span className={`dd-tag ${state === 'changed' ? 'dd-tag-warn' : 'dd-tag-sent'}`}>{label}</span>}
              {t.text && (
                <div className="dd-icons">
                  <button type="button" className="dd-icon" onClick={() => void onCopy(t.name, t.text!)} aria-label={`${t.name} 글 복사`} title={copiedKey === t.name ? '복사됨' : '복사'}>
                    {copiedKey === t.name ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                  <button
                    type="button"
                    className="dd-icon dd-icon-primary"
                    onClick={() => void onShare(t.name, t.text!)}
                    disabled={!canShare}
                    aria-label={`${t.name} 글 카카오톡 보내기`}
                    title={canShare ? '카카오톡 보내기' : '휴대폰에서 쓸 수 있습니다. 컴퓨터에서는 복사를 쓰세요.'}
                  >
                    <Send size={20} />
                  </button>
                </div>
              )}
            </div>
            {t.text ? (
              <pre className="dd-text">{t.text}</pre>
            ) : (
              <p className="dd-empty">상차된 박스가 없어 보낼 글이 없습니다.</p>
            )}
          </li>
          );
        })}
      </ul>
      {error && <p className="ak-error" role="alert">{error}</p>}

        <style>{`
          .dd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-inner); }
          .dd-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: var(--space-inner); min-width: 0; }
          .dd-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
          .dd-name { font-size: var(--fs-lg); }
          .dd-count { font-size: var(--fs-sm); color: var(--muted-foreground, #64748b); font-weight: 700; }
          .dd-tag { font-size: var(--fs-xs); font-weight: 800; border-radius: 999px; padding: 0.15rem 0.6rem; background: #dcfce7; color: #15803d; }
          .dd-tag-sent { background: #e0f2fe; color: #0369a1; }
          .dd-tag-warn { background: #fef3c7; color: #b45309; }
          .dd-text { margin: 0; padding: 0.6rem 0.8rem; background: #f8fafc; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; font-size: var(--fs-md); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
          .dd-icons { margin-left: auto; display: flex; gap: 0.5rem; }
          .dd-icon { display: inline-flex; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--foreground); cursor: pointer; }
          .dd-icon-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
          .dd-icon:disabled { opacity: 0.4; cursor: not-allowed; }
          .dd-empty { margin: 0; font-size: var(--fs-sm); color: var(--muted-foreground, #64748b); }
        `}</style>
    </>
  );
}
