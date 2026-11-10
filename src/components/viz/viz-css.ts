// 라이트 전용: 앱 전체가 라이트라서 다크 토큰은 켜지 않는다(OS 다크일 때 밝은 페이지 위에 어두운 카드만 뜨는 것을 막는다).
// 다크 팔레트는 검증 완료(표면 #1a1a19): 1번 #3987e5, 2번 #d95926, 3번 #199e70 — 앱에 다크 테마가 생기면 아래 변수를 같은 방식으로 덮어쓴다.
export const VIZ_CSS = `
.viz-root { --surface-1: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --hover: rgba(11, 11, 11, 0.05); --border: rgba(11, 11, 11, 0.10); --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
.viz-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
.viz-tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.viz-tile-label { display: inline-flex; align-items: center; gap: 0.45rem; font-size: var(--fs-sm); color: var(--text-secondary); }
.viz-tile-value { font-size: var(--fs-num); font-weight: 800; color: var(--text-primary); line-height: 1.2; overflow-wrap: anywhere; }
.viz-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-card); display: flex; flex-direction: column; gap: var(--space-inner); min-width: 0; }
.viz-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.viz-title { font-size: var(--fs-lg); font-weight: 800; color: var(--text-primary); }
.viz-sub { font-size: var(--fs-xs); color: var(--text-muted); }
.viz-legend { display: flex; gap: 1.1rem; flex-wrap: wrap; font-size: var(--fs-sm); color: var(--text-secondary); }
.viz-legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
.viz-key-line { display: inline-block; width: 16px; height: 2px; border-radius: 1px; }
.viz-key-box { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.viz-tip { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 0.55rem 0.7rem; box-shadow: 0 4px 14px rgba(11, 11, 11, 0.12); font-size: var(--fs-sm); min-width: 11rem; display: flex; flex-direction: column; gap: 0.3rem; }
.viz-tip-head { color: var(--text-secondary); font-size: var(--fs-xs); }
.viz-tip-row { display: flex; align-items: center; gap: 0.5rem; }
.viz-tip-row strong { color: var(--text-primary); font-weight: 600; margin-left: auto; padding-left: 0.6rem; }
.viz-tip-name { color: var(--text-secondary); }
.viz-tip-note { color: var(--text-muted); font-size: var(--fs-xs); border-top: 1px solid var(--grid); padding-top: 0.3rem; }

.viz-seg-btn { height: 2.25rem; padding: 0 1rem; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 700; cursor: pointer; }

.viz-seg-btn.is-on { background: var(--text-primary); border-color: var(--text-primary); color: #fff; }
.viz-controls { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem 1rem; flex-wrap: wrap; }
.viz-seg { display: inline-flex; align-items: center; gap: 0.3rem; }
.viz-seg-label { font-size: var(--fs-xs); color: var(--text-muted); margin-right: 0.2rem; }
.viz-seg-btn { height: 1.9rem; padding: 0 0.8rem; font-weight: 600; }
.viz-empty { padding: 3rem 1rem; text-align: center; color: var(--text-muted); }
.viz-table-wrap summary { cursor: pointer; font-size: var(--fs-sm); color: var(--text-secondary); }
.viz-table-scroll { overflow-x: auto; margin-top: 0.5rem; }
.viz-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
.viz-table th, .viz-table td { padding: 0.35rem 0.6rem; text-align: right; border-bottom: 1px solid var(--grid); white-space: nowrap; }
.viz-table th:first-child, .viz-table td:first-child { text-align: left; }
.viz-table th { color: var(--text-secondary); font-weight: 600; }
.viz-table tfoot td { font-weight: 600; border-bottom: 0; }
@media (max-width: 720px) { .viz-tiles { grid-template-columns: 1fr; } }
`;
