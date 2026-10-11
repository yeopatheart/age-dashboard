'use client';
import { COLOR_HUES, resolveColors } from '@/lib/color-palette';

// 상품·터미널 색상 선택기. 안쪽색과 테두리색을 각각 팔레트에서 고른다(자유 입력 없음).
export function ColorPicker({
  fill,
  border,
  onChange,
  sample,
}: {
  fill: string | null;
  border: string | null;
  onChange: (fill: string | null, border: string | null) => void;
  sample: string;
}) {
  const c = resolveColors(fill, border);
  return (
    <div className="cp-root">
      <div className="cp-row">
        <span className="cp-label">안쪽색</span>
        <div className="cp-swatches">
          {COLOR_HUES.map((h) => (
            <button
              key={h.key}
              type="button"
              title={h.label}
              onClick={() => onChange(h.key, border)}
              className={`cp-swatch ${fill === h.key ? 'cp-swatch-on' : ''}`}
              style={{ backgroundColor: h.fill, borderColor: h.border }}
            />
          ))}
        </div>
      </div>
      <div className="cp-row">
        <span className="cp-label">테두리색</span>
        <div className="cp-swatches">
          {COLOR_HUES.map((h) => (
            <button
              key={h.key}
              type="button"
              title={h.label}
              onClick={() => onChange(fill, h.key)}
              className={`cp-swatch ${border === h.key ? 'cp-swatch-on' : ''}`}
              style={{ backgroundColor: h.border, borderColor: h.border }}
            />
          ))}
        </div>
      </div>
      <div className="cp-row">
        <span className="cp-label">미리보기</span>
        <span className="cp-sample" style={{ backgroundColor: c.fill, borderColor: c.border, color: c.text }}>{sample}</span>
        <button type="button" className="cp-reset" onClick={() => onChange(null, null)}>기본으로</button>
      </div>
      <style>{`
        .cp-root { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; background: var(--muted); border-radius: var(--radius-lg); }
        .cp-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
        .cp-label { width: 3.6rem; font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); flex-shrink: 0; }
        .cp-swatches { display: flex; gap: 0.35rem; flex-wrap: wrap; }
        .cp-swatch { width: 24px; height: 24px; border-radius: 999px; border: 2px solid; cursor: pointer; padding: 0; }
        .cp-swatch-on { outline: 2px solid #0f172a; outline-offset: 2px; }
        .cp-sample { border: 2px solid; border-radius: 8px; padding: 0.25rem 0.9rem; font-size: 0.8125rem; font-weight: 700; }
        .cp-reset { margin-left: auto; font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; cursor: pointer; }
      `}</style>
    </div>
  );
}
