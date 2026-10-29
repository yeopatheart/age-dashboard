'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// 날짜 선택 줄(‹ 날짜 ›  [오늘]): 박스 할당·주문 입력 등 여러 메뉴가 같은 모양을 쓴다. 미래 날짜는 고를 수 없다.
// 모양 규칙은 이 파일 한 곳에 둔다 — 메뉴마다 따로 만들면 날짜 버튼이 제각각이 된다.
export function DateNav({ value, today, onChange, label = '날짜' }: { value: string; today: string; onChange: (date: string) => void; label?: string }) {
  const shift = (days: number) => {
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= today) onChange(next);
  };
  return (
    <div className="dn-root" role="group" aria-label={label}>
      <button type="button" className="dn-btn" onClick={() => shift(-1)} title="전날" aria-label="전날"><ChevronLeft size={14} /></button>
      <input type="date" className="dn-date" value={value} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={label} />
      <button type="button" className="dn-btn" onClick={() => shift(1)} disabled={value >= today} title="다음날" aria-label="다음날"><ChevronRight size={14} /></button>
      {value !== today && <button type="button" className="dn-today" onClick={() => onChange(today)}>오늘</button>}
      <style>{`
        .dn-root { display: inline-flex; align-items: center; gap: 0.4rem; }
        .dn-btn, .dn-today { display: inline-flex; align-items: center; justify-content: center; height: var(--ctl-h); min-width: var(--ctl-h); padding: 0 0.7rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.8125rem; font-weight: 700; color: var(--foreground); cursor: pointer; }
        .dn-btn:hover, .dn-today:hover { background: var(--muted); }
        .dn-btn:disabled { opacity: 0.45; cursor: default; }
        .dn-today { background: var(--primary); border-color: var(--primary); color: #fff; }
        .dn-date { height: var(--ctl-h); border: 1px solid var(--border); border-radius: 999px; padding: 0 0.8rem; font-size: 0.875rem; font-weight: 700; background: #fff; color: var(--foreground); font-family: var(--font-sans); }
        .dn-date:focus { outline: none; border-color: var(--primary); }
        @media (max-width: 768px) { .dn-date { padding: 0 0.6rem; } }
      `}</style>
    </div>
  );
}
