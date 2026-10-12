'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { GRANULARITY_LABEL, shiftAnchor, type Granularity, type ReportSummary } from '@/lib/report';

type View = 'product' | 'business' | 'terminal';
const VIEW_LABEL: Record<View, string> = { product: '상품별', business: '업체별', terminal: '터미널별' };
const UNIT_ORDER = ['미', 'kg', '팩', '개'];

interface Row {
  name: string;
  terminal?: string;
  units: Record<string, { qty: number; extra: number }>;
  metrics: Record<string, number>;
}

// 판매량을 "단위별로 모두" 보여주는 게 요구라 단위를 더하지 않는다 — 단위마다 따로 합산해 칩으로 나열한다.
const sortUnits = (units: string[]) =>
  [...units].sort((a, b) => (UNIT_ORDER.indexOf(a) + 100) % 100 - (UNIT_ORDER.indexOf(b) + 100) % 100 || a.localeCompare(b));

const fmtNum = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');

function buildRows(summary: ReportSummary, view: View): { rows: Row[]; metricLabels: Record<string, string> } {
  const byName = new Map<string, Row>();
  const get = (name: string, terminal?: string) => {
    let r = byName.get(name);
    if (!r) {
      r = { name, terminal, units: {}, metrics: {} };
      byName.set(name, r);
    }
    return r;
  };

  if (view === 'product') {
    for (const p of summary.products) get(p.name).units[p.unit] = { qty: Number(p.qty), extra: Number(p.extra_kg) };
    for (const s of summary.product_stats) {
      const r = get(s.name);
      r.metrics.businesses = Number(s.businesses);
      r.metrics.days = Number(s.days);
    }
    return { rows: [...byName.values()], metricLabels: { businesses: '주문 업체 수', days: '주문 일수' } };
  }
  if (view === 'business') {
    for (const u of summary.business_units) {
      const r = get(u.name, u.terminal);
      r.units[u.unit] = { qty: Number(u.qty), extra: Number(u.extra_kg) };
      r.metrics.lines = (r.metrics.lines ?? 0) + Number(u.lines);
    }
    for (const s of summary.business_stats) {
      const r = get(s.name, s.terminal);
      r.metrics.days = Number(s.days);
      r.metrics.boxes = Number(s.boxes);
      r.metrics.lines ??= 0;
    }
    return { rows: [...byName.values()], metricLabels: { lines: '주문 상품 수', days: '주문 일수', boxes: '박스 수' } };
  }
  for (const u of summary.terminal_units) {
    const r = get(u.name);
    r.units[u.unit] = { qty: Number(u.qty), extra: Number(u.extra_kg) };
    r.metrics.lines = (r.metrics.lines ?? 0) + Number(u.lines);
  }
  for (const s of summary.terminal_stats) {
    const r = get(s.name);
    r.metrics.boxes = Number(s.boxes);
    r.metrics.businesses = Number(s.businesses);
    r.metrics.days = Number(s.days);
    r.metrics.lines ??= 0;
  }
  return { rows: [...byName.values()], metricLabels: { boxes: '박스 수', businesses: '업체 수', days: '배송 일수', lines: '주문 상품 수' } };
}

const DEFAULT_SORT: Record<View, string> = { product: 'businesses', business: 'lines', terminal: 'boxes' };

export function ReportsClient({
  summary,
  granularity,
  anchor,
  today,
  period,
}: {
  summary: ReportSummary;
  granularity: Granularity;
  anchor: string;
  today: string;
  period: { from: string; to: string; label: string };
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('product');
  const [sortKey, setSortKey] = useState<string>(DEFAULT_SORT.product);

  const go = (g: Granularity, date: string) => router.push(`/reports?g=${g}&date=${date}`);
  const changeView = (v: View) => {
    setView(v);
    setSortKey(DEFAULT_SORT[v]);
  };

  const { rows, metricLabels } = useMemo(() => buildRows(summary, view), [summary, view]);
  const allUnits = useMemo(() => sortUnits([...new Set(rows.flatMap((r) => Object.keys(r.units)))]), [rows]);

  const sortOptions = [
    ...Object.entries(metricLabels).map(([key, label]) => ({ key, label })),
    ...allUnits.map((u) => ({ key: `unit:${u}`, label: `${u} 합계` })),
    { key: 'name', label: '이름순' },
  ];
  const valueOf = (r: Row, key: string) => (key.startsWith('unit:') ? r.units[key.slice(5)]?.qty ?? 0 : r.metrics[key] ?? 0);
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        sortKey === 'name' ? a.name.localeCompare(b.name, 'ko') : valueOf(b, sortKey) - valueOf(a, sortKey) || a.name.localeCompare(b.name, 'ko'),
      ),
    [rows, sortKey],
  );
  const barMax = sortKey === 'name' ? Math.max(...sorted.map((r) => valueOf(r, DEFAULT_SORT[view])), 1) : Math.max(...sorted.map((r) => valueOf(r, sortKey)), 1);
  const barKey = sortKey === 'name' ? DEFAULT_SORT[view] : sortKey;

  const downloadCsv = () => {
    const metricKeys = Object.keys(metricLabels);
    const head = ['순위', VIEW_LABEL[view].replace('별', ''), ...(view === 'business' ? ['터미널'] : []), ...metricKeys.map((k) => metricLabels[k]), ...allUnits.flatMap((u) => [`${u} 합계`, `${u} 부가중량(kg)`])];
    const lines = sorted.map((r, i) => [
      i + 1,
      r.name,
      ...(view === 'business' ? [r.terminal ?? ''] : []),
      ...metricKeys.map((k) => r.metrics[k] ?? 0),
      ...allUnits.flatMap((u) => [r.units[u]?.qty ?? 0, r.units[u]?.extra ?? 0]),
    ]);
    const csv = [head, ...lines].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `리포트_${VIEW_LABEL[view]}_${period.from}_${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nextDisabled = shiftAnchor(granularity, anchor, 1) > today && period.to >= today;

  return (
    <div className="reports-root">
      <div className="page-header">
        <div className="page-header-icon"><BarChart3 size={20} /></div>
        <div>
          <h1 className="page-title">리포트</h1>
          <p className="page-sub">기간별로 상품·업체·터미널의 주문 수량을 단위별로 확인합니다. 취소된 상품은 제외됩니다.</p>
        </div>
      </div>

      <div className="period-card">
        <div className="seg">
          {(Object.keys(GRANULARITY_LABEL) as Granularity[]).map((g) => (
            <button key={g} className={granularity === g ? 'seg-on' : ''} onClick={() => go(g, anchor)}>{GRANULARITY_LABEL[g]}</button>
          ))}
        </div>
        <div className="period-nav">
          <button onClick={() => go(granularity, shiftAnchor(granularity, anchor, -1))} title="이전"><ChevronLeft size={16} /></button>
          <span className="period-label">{period.label}</span>
          <button onClick={() => go(granularity, shiftAnchor(granularity, anchor, 1))} disabled={nextDisabled} title="다음"><ChevronRight size={16} /></button>
          <input type="date" value={anchor} max={today} onChange={(e) => e.target.value && go(granularity, e.target.value)} />
          <button className="today-btn" onClick={() => go(granularity, today)}>오늘</button>
        </div>
      </div>

      <div className="tool-row">
        <div className="seg">
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
            <button key={v} className={view === v ? 'seg-on' : ''} onClick={() => changeView(v)}>{VIEW_LABEL[v]}</button>
          ))}
        </div>
        <label className="sort-box">
          정렬
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {sortOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <span className="count-text">{sorted.length}개</span>
        <button className="csv-btn" onClick={downloadCsv} disabled={sorted.length === 0}><Download size={14} /> 엑셀(CSV) 내려받기</button>
      </div>

      {sorted.length === 0 ? (
        <p className="empty-text">이 기간에는 주문이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{VIEW_LABEL[view].replace('별', '')}</th>
                {Object.entries(metricLabels).map(([k, label]) => <th key={k} className="num">{label}</th>)}
                <th>수량 (단위별)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const barWidth = `${Math.round((valueOf(r, barKey) / barMax) * 100)}%`;
                return (
                  <tr key={r.name}>
                    <td className="rank">{i + 1}</td>
                    <td className="name-cell">
                      <span className="name-text">{r.name}</span>
                      {view === 'business' && r.terminal && <span className="term-text">{r.terminal}</span>}
                      <div className="bar"><div style={{ width: barWidth }} /></div>
                    </td>
                    {Object.keys(metricLabels).map((k) => <td key={k} className="num">{fmtNum(r.metrics[k] ?? 0)}</td>)}
                    <td>
                      <div className="unit-chips">
                        {sortUnits(Object.keys(r.units)).filter((u) => u !== '' || r.units[u].qty > 0).map((u) => (
                          <span key={u} className="unit-chip">
                            <strong>{fmtNum(r.units[u].qty)}</strong>{u}
                            {r.units[u].extra > 0 && <em>(+{fmtNum(r.units[u].extra)}kg)</em>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot-note">미 상품의 <em>(+kg)</em>은 &quot;1미+2.5kg&quot;처럼 마릿수와 함께 적은 부가 중량의 합계입니다. 단위가 다른 수량은 더하지 않고 단위별로 따로 보여줍니다.</p>

      <style>{`
        .reports-root { display: flex; flex-direction: column; gap: 1rem; }
        .period-card { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 0.85rem 1rem; }
        .seg { display: inline-flex; background: var(--muted); border-radius: 10px; padding: 3px; gap: 2px; }
        .seg button { border: none; background: transparent; font-size: 0.8125rem; font-weight: 700; padding: 0.4rem 1rem; border-radius: 8px; color: var(--muted-foreground); cursor: pointer; }
        .seg button.seg-on { background: #fff; color: var(--primary); box-shadow: var(--shadow-sm); }
        .period-nav { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .period-nav button { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: 8px; background: #fff; cursor: pointer; }
        .period-nav button:disabled { opacity: 0.35; cursor: default; }
        .period-nav .today-btn { width: auto; padding: 0 0.8rem; font-size: 0.8125rem; font-weight: 700; }
        .period-nav input { border: 1px solid var(--border); border-radius: 8px; padding: 0.3rem 0.5rem; font-size: 0.8125rem; }
        .period-label { font-size: 1rem; font-weight: 800; color: var(--primary); min-width: 11rem; text-align: center; }
        .tool-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .sort-box { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; font-weight: 700; color: var(--muted-foreground); }
        .sort-box select { appearance: none; -webkit-appearance: none; border: 1px solid var(--border); border-radius: 999px; height: 2.25rem; padding: 0 2.25rem 0 1rem; font-size: 0.8125rem; font-weight: 600; background-color: #fff; background-image: var(--select-chevron); background-repeat: no-repeat; background-position: right 0.7rem center; background-size: 1rem; cursor: pointer; }
        .count-text { font-size: 0.8125rem; color: var(--muted-foreground); }
        .csv-btn { margin-left: auto; display: flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; font-weight: 700; padding: 0.45rem 0.9rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--primary); cursor: pointer; }
        .csv-btn:disabled { opacity: 0.45; cursor: default; }
        .empty-text { color: var(--muted-foreground); font-size: 0.9rem; padding: 2.5rem 0; text-align: center; }
        .table-wrap { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow-x: auto; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .report-table th { text-align: left; font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); background: var(--muted); padding: 0.6rem 0.8rem; white-space: nowrap; }
        .report-table td { padding: 0.55rem 0.8rem; border-top: 1px solid var(--border); vertical-align: middle; }
        .report-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rank { width: 2.5rem; color: var(--muted-foreground); font-size: 0.8125rem; }
        .name-cell { min-width: 12rem; }
        .name-text { font-weight: 700; }
        .term-text { margin-left: 0.5rem; font-size: 0.75rem; color: var(--muted-foreground); }
        .bar { height: 4px; background: var(--muted); border-radius: 999px; margin-top: 0.35rem; overflow: hidden; }
        .bar > div { height: 100%; background: var(--primary); border-radius: 999px; opacity: 0.55; }
        .unit-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .unit-chip { display: inline-flex; align-items: baseline; gap: 0.15rem; padding: 0.15rem 0.6rem; border-radius: 999px; background: #f1f5f9; border: 1px solid #e2e8f0; font-size: 0.8125rem; white-space: nowrap; }
        .unit-chip strong { font-size: 0.9375rem; }
        .unit-chip em { font-style: normal; font-size: 0.6875rem; color: var(--muted-foreground); margin-left: 0.2rem; }
        .foot-note { font-size: 0.75rem; color: var(--muted-foreground); }
        .foot-note em { font-style: normal; font-weight: 700; }
      `}</style>
    </div>
  );
}
