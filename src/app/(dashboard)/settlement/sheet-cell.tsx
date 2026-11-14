'use client';
import { useState } from 'react';

// 정산표·품목 단가표가 함께 쓰는 입력칸 하나. 타자를 치는 동안의 글자는 이 칸만 다시 그리게 칸 안에 둔다(표 전체를 다시 그리지 않는다).
// 칸을 벗어나면 저장한다. 칸 이동(Enter·방향키)은 표가 data-r/data-c(정산표) 또는 data-pr/data-pc(단가표)로 칸을 찾아 처리한다.
export function Cell({ r, c, numeric, grid = 'sheet', value, label, disabled, edited, muted, list, onCommit }: { r: number; c: string; numeric?: boolean; grid?: 'sheet' | 'price'; value: string; label: string; disabled: boolean; edited?: boolean; muted?: boolean; list?: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const attrs = grid === 'sheet' ? { 'data-r': r, 'data-c': c } : { 'data-pr': r, 'data-pc': c };
  return (
    <input
      className={`st-cell${numeric ? ' is-num' : ''}${edited ? ' is-edited' : ''}${muted ? ' is-auto' : ''}`}
      {...attrs}
      value={draft ?? value}
      disabled={disabled}
      aria-label={label}
      inputMode={numeric ? 'decimal' : undefined}
      list={list}
      autoComplete="off"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        setDraft(null);
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}
