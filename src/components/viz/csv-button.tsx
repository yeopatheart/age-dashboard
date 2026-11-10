'use client';
// 표를 엑셀(CSV)로 내려받는 버튼. 엑셀에서 한글이 깨지지 않게 앞에 BOM을 붙인다.
import { Download } from 'lucide-react';
import { buildCsv } from '@/lib/reports/csv';

export function CsvButton({ filename, header, rows, disabled = false }: { filename: string; header: string[]; rows: (string | number | null)[][]; disabled?: boolean }) {
  const download = () => {
    const blob = new Blob(['﻿' + buildCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <button type="button" className="viz-seg-btn" onClick={download} disabled={disabled || rows.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <Download size={14} aria-hidden /> 엑셀(CSV)
    </button>
  );
}
