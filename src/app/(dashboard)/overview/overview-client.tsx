'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { BoxDots } from '@/components/box-dots';
import { DateNav } from '@/components/date-nav';
import { STAGES, STAGE_LABEL, stageDetail, totalsOf, type OverviewCard, type Stage } from '@/lib/overview';

type Scope = 'all' | 'main' | 'separate';
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'main', label: '기본' },
  { key: 'separate', label: '별도' },
];
type Filter = 'open' | 'all' | Stage;

// 대시보드(진행 현황): 하루 주문이 박스 할당 → 라벨 출력 → 포장 → 상차 어디까지 왔는지 한눈에 본다.
// 단계는 고객사 단위로 세고, 박스 단위인 라벨·상차는 고객 행의 박스 점과 "n/m박스"로 보여준다. 읽기 전용이다.
export function OverviewClient({ orderDate, today, cards }: { orderDate: string; today: string; cards: OverviewCard[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('all');
  const [filter, setFilter] = useState<Filter>('open');
  const [refreshing, setRefreshing] = useState(false);

  const scoped = cards.filter((c) => c.hasOrder && (scope === 'all' ? true : scope === 'separate' ? c.separate : !c.separate));
  const totals = totalsOf(scoped);
  const shown = scoped.filter((c) => (filter === 'all' ? true : filter === 'open' ? c.stage !== 'done' : c.stage === filter));

  const terminalNames = [...new Set(scoped.map((c) => c.terminal || '미지정'))];
  const byTerminal = terminalNames.map((name) => ({ name, totals: totalsOf(scoped.filter((c) => (c.terminal || '미지정') === name)) }));

  const go = (date: string) => router.push(`/overview?date=${date}`);
  const refresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="ov-root">
      <div className="ov-bar">
        <h1 className="ov-title">대시보드</h1>
        <DateNav value={orderDate} today={today} onChange={go} />
        <div className="ov-seg" role="group" aria-label="구분">
          {SCOPES.map((s) => (
            <button key={s.key} type="button" className={scope === s.key ? 'ov-seg-on' : ''} onClick={() => setScope(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="ov-refresh" onClick={refresh} aria-label="새로고침" title="새로고침">
          <RefreshCw size={14} className={refreshing ? 'ov-spin' : ''} />
        </button>
      </div>

      {totals.customers === 0 ? (
        <p className="ov-empty">이 날짜에는 주문이 없습니다.</p>
      ) : (
        <>
          <section className="ov-card">
            <div className="ov-head">
              <h2>출고 현황</h2>
              <span className="ov-head-main">
                출고 완료 <b>{totals.byStage.done}</b>/{totals.customers}곳
              </span>
            </div>
            <div className="ov-stack" aria-hidden>
              {STAGES.map((s) => totals.byStage[s] > 0 && <span key={s} className={`ov-seg-${s}`} style={{ flexGrow: totals.byStage[s] }} />)}
            </div>
            <div className="ov-tiles" role="group" aria-label="단계별 고객 수">
              {STAGES.map((s) => (
                <button key={s} type="button" aria-pressed={filter === s} className={`ov-tile ${filter === s ? 'ov-tile-on' : ''}`} onClick={() => setFilter(filter === s ? 'open' : s)}>
                  <span className={`ov-dot ov-seg-${s}`} />
                  <span className="ov-tile-label">{STAGE_LABEL[s]}</span>
                  <strong>{totals.byStage[s]}<small>곳</small></strong>
                </button>
              ))}
            </div>
            <p className="ov-boxline">
              박스 <b>{totals.boxes}</b>개 중 라벨 출력 <b>{totals.boxesPrinted}</b> · 상차 <b>{totals.boxesLoaded}</b>
              {totals.byStage.boxing > 0 && <span> (박스 미정 {totals.byStage.boxing}곳 제외)</span>}
            </p>
          </section>

          {byTerminal.length > 1 && (
            <section className="ov-card">
              <h2>터미널별</h2>
              <ul className="ov-terms">
                {byTerminal.map(({ name, totals: t }) => (
                  <li key={name}>
                    <span className="ov-term-name">{name}</span>
                    <div className="ov-stack ov-stack-sm" aria-hidden>
                      {STAGES.map((s) => t.byStage[s] > 0 && <span key={s} className={`ov-seg-${s}`} style={{ flexGrow: t.byStage[s] }} />)}
                    </div>
                    <span className="ov-term-num">
                      <b>{t.byStage.done}</b>/{t.customers}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="ov-card">
            <div className="ov-head">
              <h2>고객별 진행</h2>
              <div className="ov-chips" role="group" aria-label="목록 필터">
                <button type="button" className={filter === 'open' ? 'ov-chip-on' : ''} onClick={() => setFilter('open')}>
                  진행 중 <b>{totals.customers - totals.byStage.done}</b>
                </button>
                <button type="button" className={filter === 'all' ? 'ov-chip-on' : ''} onClick={() => setFilter('all')}>
                  전체 <b>{totals.customers}</b>
                </button>
              </div>
            </div>
            {typeof filter === 'string' && filter !== 'open' && filter !== 'all' && (
              <p className="ov-filter-note">{STAGE_LABEL[filter]} 단계만 보는 중 · 같은 칸을 다시 누르면 해제됩니다</p>
            )}
            <p className="ov-legend" aria-hidden>
              박스 번호별 <BoxDots states={['none']} /> 라벨 미출력 <BoxDots states={['printed']} /> 출력 <BoxDots states={['loaded']} /> 상차
            </p>
            {shown.length === 0 ? (
              <p className="ov-empty">해당하는 고객이 없습니다.</p>
            ) : (
              <ul className="ov-list">
                {shown.map((c) => (
                  <li key={c.id} className={`ov-row ${c.stage === 'done' ? 'ov-row-done' : ''}`}>
                    <div className="ov-row-top">
                      <span className="ov-no">{c.number}</span>
                      <div className="ov-name">
                        <strong>{c.name}</strong>
                        {c.roundLabel && <em>{c.roundLabel}</em>}
                        <span className="ov-term">{c.terminal || '미지정'}</span>
                      </div>
                      <span className={`ov-stage ov-stage-${c.stage}`}>{STAGE_LABEL[c.stage]}</span>
                    </div>
                    <div className="ov-row-sub">
                      <BoxDots states={c.boxStates} />
                      <span className="ov-detail">{stageDetail(c.stage, c)}</span>
                      {c.packingChanged && (
                        <span className="ov-warn">
                          <TriangleAlert size={12} /> 박스 재확인
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <style>{`
        .ov-root { --c-boxing: #f59e0b; --c-labeling: #8b5cf6; --c-packing: #3b82f6; --c-packed: #14b8a6; --c-loading: #0ea5e9; --c-done: #16a34a; display: flex; flex-direction: column; gap: 0.9rem; padding: 1rem 1.2rem 2rem; max-width: 72rem; margin: 0 auto; width: 100%; min-width: 0; }
        .ov-bar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
        .ov-title { font-size: 1.25rem; font-weight: 800; margin-right: 0.3rem; }
        .ov-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: #fff; }
        .ov-seg button { height: var(--ctl-h); padding: 0 0.9rem; font-size: 0.8125rem; font-weight: 700; border: 0; background: transparent; color: var(--muted-foreground); cursor: pointer; }
        .ov-seg .ov-seg-on { background: var(--primary); color: #fff; }
        .ov-refresh { display: inline-flex; align-items: center; justify-content: center; height: var(--ctl-h); width: var(--ctl-h); border-radius: 999px; border: 1px solid var(--border); background: #fff; cursor: pointer; margin-left: auto; }
        .ov-spin { animation: ov-spin 0.6s linear infinite; }
        @keyframes ov-spin { to { transform: rotate(360deg); } }
        .ov-empty { color: var(--muted-foreground); font-size: 0.875rem; padding: 1.2rem 0; text-align: center; }
        .ov-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 0.9rem 1rem 1rem; display: flex; flex-direction: column; gap: 0.7rem; min-width: 0; }
        .ov-card h2 { font-size: 0.9375rem; font-weight: 800; }
        .ov-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
        .ov-head-main { font-size: 0.9375rem; font-weight: 700; color: var(--muted-foreground); }
        .ov-head-main b { font-size: 1.5rem; font-weight: 900; color: var(--foreground); line-height: 1.3; }
        .ov-seg-boxing { background: var(--c-boxing); } .ov-seg-labeling { background: var(--c-labeling); } .ov-seg-packing { background: var(--c-packing); }
        .ov-seg-packed { background: var(--c-packed); } .ov-seg-loading { background: var(--c-loading); } .ov-seg-done { background: var(--c-done); }
        .ov-stack { display: flex; gap: 2px; height: 12px; border-radius: 999px; overflow: hidden; background: #e2e8f0; }
        .ov-stack span { min-width: 6px; }
        .ov-stack-sm { height: 8px; flex: 1; }
        .ov-tiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0.45rem; }
        .ov-tile { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 0.4rem; row-gap: 0.1rem; text-align: left; border: 1px solid var(--border); border-radius: 12px; background: #fff; padding: 0.5rem 0.65rem; cursor: pointer; font-family: inherit; color: var(--foreground); min-width: 0; }
        .ov-tile-on { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
        .ov-dot { width: 10px; height: 10px; border-radius: 999px; }
        .ov-tile-label { font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); white-space: nowrap; }
        .ov-tile strong { grid-column: 1 / -1; font-size: 1.5rem; font-weight: 900; line-height: 1.3; }
        .ov-tile small { font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); margin-left: 0.1rem; }
        .ov-boxline { font-size: 0.8125rem; font-weight: 600; color: var(--muted-foreground); line-height: 1.5; }
        .ov-boxline b { color: var(--foreground); font-weight: 800; }
        .ov-terms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
        .ov-terms li { display: flex; align-items: center; gap: 0.7rem; }
        .ov-term-name { flex: none; width: 6rem; font-size: 0.8125rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ov-term-num { flex: none; width: 3.2rem; text-align: right; font-size: 0.8125rem; font-weight: 700; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
        .ov-term-num b { color: var(--foreground); }
        .ov-chips { display: flex; gap: 0.4rem; }
        .ov-chips button { height: var(--chip-h); padding: 0 0.8rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.8125rem; font-weight: 700; color: var(--foreground); cursor: pointer; white-space: nowrap; }
        .ov-chips b { margin-left: 0.2rem; font-weight: 800; }
        .ov-chips .ov-chip-on { background: var(--primary); border-color: var(--primary); color: #fff; }
        .ov-filter-note { font-size: 0.75rem; font-weight: 700; color: var(--primary); }
        .ov-legend { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); line-height: 1.5; }
        .ov-legend .bd-root { margin-left: 0.3rem; }
        .ov-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
        .ov-row { display: flex; flex-direction: column; gap: 0.5rem; border: 1px solid var(--border); border-radius: 12px; padding: 0.6rem 0.75rem; min-width: 0; }
        .ov-row-done { background: #f7fef9; border-color: #bbf7d0; }
        .ov-row-top { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
        .ov-no { flex: none; width: 1.6rem; height: 1.6rem; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 0.75rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
        .ov-name { flex: 1; display: flex; align-items: baseline; gap: 0.45rem; min-width: 0; }
        .ov-name strong { font-size: 0.9375rem; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; line-height: 1.5; }
        .ov-name em { flex: none; font-style: normal; font-size: 0.75rem; font-weight: 800; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 0.05rem 0.5rem; }
        .ov-term { flex: none; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); }
        .ov-stage { flex: none; font-size: 0.75rem; font-weight: 800; border-radius: 999px; padding: 0.15rem 0.65rem; line-height: 1.5; white-space: nowrap; }
        .ov-stage-boxing { background: #fffbeb; color: #92400e; } .ov-stage-labeling { background: #f5f3ff; color: #6d28d9; } .ov-stage-packing { background: #eff6ff; color: #1d4ed8; }
        .ov-stage-packed { background: #f0fdfa; color: #0f766e; } .ov-stage-loading { background: #f0f9ff; color: #0369a1; } .ov-stage-done { background: #dcfce7; color: #15803d; }
        .ov-row-sub { display: flex; align-items: center; gap: 0.6rem; min-width: 0; padding-left: 2.2rem; font-size: 0.75rem; line-height: 1.5; }
        .ov-detail { font-weight: 700; color: var(--muted-foreground); white-space: nowrap; }
        .ov-warn { display: inline-flex; align-items: center; gap: 0.2rem; margin-left: auto; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 999px; padding: 0 0.5rem; white-space: nowrap; }
        @media (max-width: 768px) {
          .ov-root { padding: 0.75rem 0.75rem 1.5rem; gap: 0.7rem; }
          .ov-title { display: none; }
          .ov-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .ov-row-sub { padding-left: 0; flex-wrap: wrap; }
        }
      `}</style>
    </div>
  );
}
