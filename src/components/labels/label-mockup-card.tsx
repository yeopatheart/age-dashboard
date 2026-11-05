'use client';
import { useState } from 'react';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { LabelMockupPrinter, type LabelMockupJob } from './label-mockup-printer';
import { DEFAULT_MOCKUP_SIZES, mockupCaption, sizeOf, type MockupSize } from '@/lib/labels/mockup';
import type { LabelData, LabelTemplate } from '@/lib/labels/template';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const LONG_NAME = '남해바다통영수산유통';

// 라벨 설정 화면의 "시안 시트" 카드: 후보 크기를 정하고 A4로 인쇄한다. 첫 줄은 지금 디자인의 원래 크기(수정 불가)다.
// 크기 후보는 이 화면에서만 쓰고 저장하지 않는다.
export function LabelMockupCard({ template, data }: { template: LabelTemplate; data: LabelData }) {
  const [extras, setExtras] = useState<MockupSize[]>(DEFAULT_MOCKUP_SIZES);
  const [longName, setLongName] = useState(false);
  const [job, setJob] = useState<LabelMockupJob | null>(null);

  const sizes = [sizeOf(template), ...extras];
  const update = (index: number, patch: Partial<MockupSize>) =>
    setExtras((list) =>
      list.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, ...patch };
        const heightMm = clamp(next.heightMm, 28, 300);
        return { widthMm: clamp(next.widthMm, 20, 300), heightMm, topHeightMm: clamp(next.topHeightMm, 10, heightMm - 8) };
      }),
    );
  const num = (value: number, onChange: (v: number) => void, label: string) => (
    <input
      type="number"
      step={1}
      value={value}
      aria-label={label}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      style={{ width: '4rem', height: '2rem', border: '1px solid var(--border)', borderRadius: 8, padding: '0 0.4rem', fontSize: '0.8125rem', fontWeight: 700 }}
    />
  );

  return (
    <section className="lb-card">
      <h3>시안 시트 (A4 종이로 크기 시험)</h3>
      <p className="ak-muted">
        지금 디자인을 여러 크기로 비례해서 줄이거나 늘려 실제 크기로 A4에 찍습니다. 잘라서 박스에 붙여 보고 거리별로 읽히는지, 모서리에 맞는지 고르는 용도입니다. 바코드 스캔과 방수·점착은 열전사 실물 라벨로 따로 확인해야 합니다.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div className="lb-row" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted-foreground)' }}>
          <span style={{ width: '4rem' }}>가로</span>
          <span style={{ width: '4rem' }}>전체 높이</span>
          <span style={{ width: '4rem' }}>상단 면</span>
        </div>
        <div className="lb-row" title={mockupCaption(sizes[0])}>
          <span style={{ width: '4rem', fontWeight: 700 }}>{template.widthMm}</span>
          <span style={{ width: '4rem', fontWeight: 700 }}>{template.heightMm}</span>
          <span style={{ width: '4rem', fontWeight: 700 }}>{template.topHeightMm}</span>
          <span className="ak-muted">현재 디자인(원본)</span>
        </div>
        {extras.map((s, i) => (
          <div key={i} className="lb-row">
            {num(s.widthMm, (v) => update(i, { widthMm: v }), '가로')}
            {num(s.heightMm, (v) => update(i, { heightMm: v }), '전체 높이')}
            {num(s.topHeightMm, (v) => update(i, { topHeightMm: v }), '상단 면 높이')}
            <button className="ak-btn" onClick={() => setExtras((list) => list.filter((_, j) => j !== i))} aria-label="이 크기 지우기"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <div className="lb-row">
        <button className="ak-btn" onClick={() => setExtras((list) => [...list, { widthMm: 90, heightMm: 70, topHeightMm: 52 }])} disabled={extras.length >= 8}><Plus size={13} /> 크기 추가</button>
        <label className="lb-check"><input type="checkbox" checked={longName} onChange={(e) => setLongName(e.target.checked)} /> 긴 업체명으로</label>
      </div>
      <button
        className="ak-btn ak-btn-primary"
        onClick={() => setJob({ template, sizes, data: longName ? { ...data, business: LONG_NAME } : data })}
      >
        <Printer size={14} /> A4 시안 인쇄
      </button>
      <p className="lb-warn">자동 인쇄 바로가기(라벨 프린터용)로 연 창에서는 쓰지 마세요. 인쇄 창 없이 라벨 프린터로 A4 시안이 나갑니다. 일반 Chrome 창에서 인쇄하세요.</p>
      <LabelMockupPrinter job={job} onDone={() => setJob(null)} />
    </section>
  );
}
