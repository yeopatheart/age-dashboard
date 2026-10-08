'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, AlertTriangle, History, ChevronDown, ChevronUp, BookOpen, X } from 'lucide-react';
import { MarkdownView } from '@/components/markdown-view';
import {
  suggestOrderLines,
  commitOrderLines,
  getOrderHistory,
  type SuggestedLine,
  type OrderHistoryEntry,
} from '../actions';

// 'ko-KR' 로케일의 오전/오후 표기는 서버(Node ICU)와 클라이언트(브라우저 ICU)가
// 서로 다른 문자열을 낼 수 있어 하이드레이션 불일치가 난다 — 'en-US'로 AM/PM만
// 받아와서 직접 오전/오후로 매핑하면 양쪽이 항상 같은 결과를 낸다.
function formatTime(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value === 'PM' ? '오후' : '오전';
  return `${dayPeriod} ${hour}:${minute}`;
}

// 주문을 입력하는 사람(형/사무실)과 대시보드를 보는 현장(TV)은 서로 다른 사람·장소다.
// 그래서 이 기능은 대시보드 위 모달이 아니라 별도 페이지로 둔다 — TV 화면이 입력 중에
// 가려지는 일이 없게 하기 위함(docs/decisions 참고). 권한으로 가리는 대신 페이지 분리로 해결한다.
export function NewOrderClient({
  orderDate,
  initialHistory,
  guideMarkdown,
}: {
  orderDate: string;
  initialHistory: OrderHistoryEntry[];
  guideMarkdown: string;
}) {
  const router = useRouter();
  const [rawText, setRawText] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestedLine[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyDate, setHistoryDate] = useState(orderDate);
  const [history, setHistory] = useState(initialHistory);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = async (date: string) => {
    setHistoryLoading(true);
    try {
      setHistory(await getOrderHistory(date));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleHistoryDateChange = (date: string) => {
    setHistoryDate(date);
    setExpandedHistoryId(null);
    loadHistory(date);
  };

  const handleAnalyze = async () => {
    if (!rawText.trim()) return;
    setAnalyzing(true);
    setError(null);
    setDone(false);
    try {
      const result = await suggestOrderLines(rawText, orderDate);
      setSuggestions(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '미리보기에 실패했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  const blockingCount = suggestions?.filter((s) => s.blocking).length ?? 0;
  const changedCount = suggestions?.filter((s) => s.kind !== 'no_change').length ?? 0;

  const handleConfirm = async () => {
    if (!suggestions) return;
    setCommitting(true);
    setError(null);
    try {
      const decisions = suggestions.filter((s) => s.kind !== 'no_change').map((s) => ({
        terminalName: s.terminalName,
        businessNameRaw: s.businessNameRaw,
        matchedBusinessId: s.matchedBusinessId,
        product: s.product,
        kind: s.kind,
        existingOrderItemId: s.existingOrderItemId,
        memo: s.memo,
      }));
      await commitOrderLines(orderDate, decisions, rawText);
      setDone(true);
      setSuggestions(null);
      setRawText('');
      if (historyDate === orderDate) await loadHistory(orderDate);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정에 실패했습니다.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="new-order-root">
      <div className="page-header">
        <div className="page-header-icon"><Sparkles size={20} /></div>
        <div>
          <h1 className="page-title">주문 입력</h1>
          <p className="page-sub">{orderDate}</p>
        </div>
        <button className="guide-btn" onClick={() => setGuideOpen(true)}>
          <BookOpen size={15} /> 입력 가이드
        </button>
      </div>

      {guideOpen && (
        <div className="guide-overlay" onClick={() => setGuideOpen(false)}>
          <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
            <div className="guide-modal-head">
              <span>카카오톡 주문 메시지 입력 가이드</span>
              <button className="guide-close" onClick={() => setGuideOpen(false)} title="닫기"><X size={16} /></button>
            </div>
            <div className="guide-modal-body"><MarkdownView source={guideMarkdown} /></div>
          </div>
        </div>
      )}

      <div className="new-order-layout">
        <div className="new-order-main">
          <div className="input-card">
            <textarea
              className="paste-area"
              placeholder={[
                '[입력 형식]  번호 터미널/ 업체명/ 상품, 상품',
                '예) 1 대구/ 엔야/ 활전갱이 5미, 활고등어 3kg',
                '',
                '• 수량 필수: 미(마리) · kg(키로) · g · 팩 · 개',
                '• 마릿수+무게: 감성돔 1미+2.5kg',
                '• 괄호는 상품 맨 끝 하나: 전복 2마리(300이상, 물봉)',
                '   물봉 · 기포기 · 얼음포장 · 재고 · 사이즈 요청',
                '• 메모: 줄 끝에 #  예) ... 벤자리 2미 #소리처럼 작업',
                '• 취소: 갯가재 취소 / 수원/ 스시태양/ 취소',
                '• 바뀐 줄만 다시 입력하면 됩니다',
                '',
                '자세한 내용은 오른쪽 위 [입력 가이드]를 눌러 확인하세요.',
              ].join('\n')}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
            />
            <button className="btn-primary analyze-btn" onClick={handleAnalyze} disabled={analyzing || !rawText.trim()}>
              {analyzing ? (
                <span className="btn-loading">
                  <Loader2 size={16} className="spin" /> 미리보기 중...
                </span>
              ) : (
                <span className="btn-loading">
                  <Sparkles size={16} /> 미리보기
                </span>
              )}
            </button>
          </div>

          {error && <p className="error-text">{error}</p>}
          {done && <p className="success-text">확정 완료 — 대시보드에 반영됐습니다.</p>}

          {suggestions && (
            <div className="review-list">
              {suggestions.length === 0 && <p className="empty-text">파싱된 항목이 없습니다.</p>}
              {suggestions.length > 0 && (
                <div className="review-bar">
                  <span className="review-bar-text">
                    입력 결과 {suggestions.length}건
                    {blockingCount > 0 && ` · 수정 필요 ${blockingCount}건 (메시지를 고친 뒤 다시 미리보기)`}
                    {suggestions.some((s) => s.needsReview) && ` · 확인 필요 ${suggestions.filter((s) => s.needsReview).length}건`}
</span>
                  {suggestions.some((s) => s.needsReview) && (
                    <button
                      className={`filter-btn ${onlyReview ? 'filter-btn-on' : ''}`}
                      onClick={() => setOnlyReview((v) => !v)}
                    >
                      확인 필요만 보기
                    </button>
                  )}
                  <button className="btn-primary confirm-btn" onClick={handleConfirm} disabled={committing || changedCount === 0 || blockingCount > 0}>
                    {committing ? '확정 중...' : `확정 (${changedCount}건)`}
                  </button>
                </div>
              )}
              {suggestions.filter((s) => !onlyReview || s.needsReview).map((s) => {
                return (
                  <div key={s.key} className={`review-row ${s.needsReview ? 'review-row-flag' : ''}`}>
                    <div className="review-row-main">
                      <span className="review-biz">{s.businessNameRaw}</span>
                      <span className="badge badge-muted">{s.terminalName}</span>
                      {s.isNewTerminal && <span className="new-tag">신규 터미널</span>}
                      {s.isNewBusiness && <span className="new-tag">신규 업체</span>}
                      <span className="review-product">{s.product.productName}</span>
                      {s.kind !== 'cancel_line' && (
                        <span className="review-qty">
                          {s.product.quantity}
                          {s.product.unit}
                          {s.product.secondaryWeightKg != null && ` +${s.product.secondaryWeightKg}kg`}
                        </span>
                      )}
                      {s.source === 'ai' && (
                        <span className="badge badge-ai">
                          <Sparkles size={11} /> AI 보정
                        </span>
                      )}
                      {s.normalizedFrom && (
                        <span className="normalized-note" title={s.normalizedFrom}>표준 형식으로 정리됨</span>
                      )}
                      {s.memo && <span className="memo-note">메모: {s.memo}</span>}
                      {s.needsReview && (
                        <span className="review-flag">
                          <AlertTriangle size={12} /> {s.reviewReason ?? '확인 필요'}
                        </span>
                      )}
                    </div>
                    <span className={`kind-badge ${s.kind === 'update_line' ? 'kind-badge-update' : s.kind === 'no_change' ? 'kind-badge-same' : s.kind === 'cancel_line' ? 'kind-badge-cancel' : 'kind-badge-add'}`}>
                      {s.kind === 'update_line' ? '기존 상품 수정' : s.kind === 'no_change' ? '변경 없음' : s.kind === 'cancel_line' ? '취소' : '추가'}
                    </span>
                  </div>
                );
              })}

            </div>
          )}
        </div>

        <aside className="history-panel">
          <div className="history-panel-header">
            <History size={16} />
            <span>입력 이력</span>
            <span className="history-count">{history.length}건</span>
          </div>
          <div className="history-date-row">
            <input
              type="date"
              value={historyDate}
              max={orderDate}
              onChange={(e) => handleHistoryDateChange(e.target.value)}
              className="history-date-input"
            />
            {historyDate === orderDate && <span className="badge badge-primary history-today-badge">오늘</span>}
            {historyLoading && <Loader2 size={14} className="spin history-date-loading" />}
          </div>
          <div className="history-list">
            {history.length === 0 && !historyLoading && <p className="empty-text">이 날짜에 입력된 메시지가 없습니다.</p>}
            {history.map((h) => {
              const expanded = expandedHistoryId === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  className="history-item"
                  onClick={() => setExpandedHistoryId(expanded ? null : h.id)}
                >
                  <div className="history-item-top">
                    <span className={`badge ${h.isFirst ? 'badge-primary' : 'badge-info'}`}>
                      {h.isFirst ? '최초주문' : '업데이트'}
                    </span>
                    <span className="history-time">{formatTime(h.createdAt)}</span>
                    {h.createdByName && <span className="history-author">{h.createdByName}</span>}
                    {expanded ? <ChevronUp size={14} className="history-chevron" /> : <ChevronDown size={14} className="history-chevron" />}
                  </div>
                  <p className={`history-text ${expanded ? 'history-text-expanded' : ''}`}>{h.rawText}</p>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <style>{`
        .new-order-root { display: flex; flex-direction: column; gap: 1.25rem; height: 100%; min-height: 0; }
        .new-order-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; align-items: stretch; }
        .new-order-main { display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; min-height: 0; overflow-y: auto; }
        .history-panel {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
          min-height: 0;
        }
        .history-panel-header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.875rem;
          font-weight: 700;
          color: var(--foreground);
        }
        .history-count { margin-left: auto; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); }
        .history-date-row { display: flex; align-items: center; gap: 0.5rem; }
        .history-date-input {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 0.35rem 0.5rem;
          font-size: 0.8125rem;
          font-family: var(--font-sans);
          color: var(--foreground);
          background: #fff;
        }
        .history-date-input:focus { outline: none; border-color: var(--primary); }
        .history-today-badge { font-size: 0.7rem; }
        .history-date-loading { color: var(--muted-foreground); margin-left: auto; }
        .history-list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; }
        .history-item {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          text-align: left;
          padding: 0.625rem 0.75rem;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--muted);
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s ease, box-shadow 0.15s ease;
        }
        .history-item:hover { background: #eef2f7; }
        .history-item-top { display: flex; align-items: center; gap: 0.4rem; }
        .history-time { font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; }
        .history-author { font-size: 0.75rem; color: var(--muted-foreground); }
        .history-chevron { margin-left: auto; color: var(--muted-foreground); flex-shrink: 0; }
        .history-text {
          font-size: 0.75rem;
          color: var(--foreground);
          line-height: 1.5;
          white-space: pre-wrap;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .history-text-expanded { -webkit-line-clamp: unset; }
        @media (max-width: 960px) {
          .new-order-root { height: auto; }
          .new-order-layout { grid-template-columns: 1fr; }
          .new-order-main { min-height: 420px; }
          .history-panel { min-height: 320px; }
        }
        .input-card {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.875rem;
          flex: 1 0 280px;
        }
        .paste-area {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 0.875rem;
          font-family: var(--font-mono, monospace);
          font-size: 0.875rem;
          resize: none;
          flex: 1;
          min-height: 160px;
        }
        .paste-area:focus { outline: none; box-shadow: 0 0 0 2px var(--primary-light); }
        .analyze-btn { align-self: flex-start; padding: 0.625rem 1.25rem; }
        .btn-loading { display: flex; align-items: center; gap: 0.5rem; justify-content: center; }
        .spin { animation: spin 0.6s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error-text { color: var(--danger); font-size: 0.875rem; font-weight: 500; }
        .success-text { color: var(--teal); font-size: 0.875rem; font-weight: 600; }
        .empty-text { color: var(--muted-foreground); font-size: 0.875rem; padding: 1rem 0; }
        .review-list { display: flex; flex-direction: column; gap: 0.625rem; flex-shrink: 0; }
        .review-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.875rem 1.125rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: #fff;
          box-shadow: var(--shadow-sm);
          flex-wrap: wrap;
        }
        .review-row-flag { border-color: #fde68a; background: #fffce8; }
        .review-row-main { display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap; }
        .review-biz { font-weight: 700; color: var(--primary); font-size: 0.9rem; }
        .review-product { font-size: 0.875rem; color: var(--foreground); }
        .review-qty { font-size: 0.8125rem; font-weight: 600; color: var(--primary); background: var(--primary-light); padding: 0.15rem 0.6rem; border-radius: 6px; }
        .review-flag { display: flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; color: var(--warning); font-weight: 500; }
        .badge-ai { display: inline-flex; align-items: center; gap: 0.25rem; background: #f5f3ff; color: #7c3aed; }
        .kind-badge { font-size: 0.8125rem; font-weight: 700; padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid; white-space: nowrap; }
        .kind-badge-add { background: #ecfdf5; border-color: #6ee7b7; color: #047857; }
        .guide-btn { margin-left: auto; display: flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 700; padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--primary); cursor: pointer; }
        .guide-btn:hover { background: var(--primary-light); }
        .guide-overlay { position: fixed; inset: 0; z-index: 50; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
        .guide-modal { background: #fff; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); width: min(860px, 100%); max-height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .guide-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border); font-weight: 800; color: var(--primary); }
        .guide-close { border: none; background: var(--muted); border-radius: 7px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .guide-modal-body { padding: 1rem 1.5rem 1.5rem; overflow-y: auto; }
        .kind-badge-cancel { background: #fff1f2; border-color: #fda4af; color: #be123c; }
        .normalized-note { font-size: 0.75rem; color: var(--muted-foreground); border-bottom: 1px dotted currentColor; cursor: help; }
        .memo-note { font-size: 0.75rem; font-weight: 600; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 0.1rem 0.45rem; }
        .kind-badge-same { background: #f1f5f9; border-color: #cbd5e1; color: #64748b; }
        .kind-badge-update { background: #fffbeb; border-color: #fcd34d; color: #b45309; }
        .confirm-btn { padding: 0.625rem 1.5rem; flex-shrink: 0; }
        /* 결과가 수십 건이면 확정 버튼이 맨 아래로 밀려 안 보이므로, 스크롤해도 항상 위에 붙어 있게 한다. */
        .review-bar {
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.625rem 1rem;
          background: var(--primary-light);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }
        .review-bar-text { flex: 1; }
        .filter-btn { font-size: 0.8125rem; font-weight: 700; padding: 0.4rem 0.9rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--muted-foreground); cursor: pointer; white-space: nowrap; }
        .filter-btn-on { background: #fffbeb; border-color: #fcd34d; color: #b45309; }
        .new-tag { font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 999px; background: #eff6ff; border: 1px solid #93c5fd; color: #1d4ed8; white-space: nowrap; }
        .review-bar-text { font-size: 0.875rem; font-weight: 700; color: var(--primary); }
      `}</style>
    </div>
  );
}
