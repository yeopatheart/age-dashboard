'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LabelView } from './label-view';
import { mockupCaption, scaleTemplate, type MockupSize } from '@/lib/labels/mockup';
import type { LabelData, LabelTemplate } from '@/lib/labels/template';

export interface LabelMockupJob {
  template: LabelTemplate;
  sizes: MockupSize[];
  data: LabelData;
}

const PAGE_MARGIN_MM = 8;
const TICK_MM = 3; // 접는 선 위치를 라벨 바깥 양옆에 표시하는 눈금 길이

// 후보 라벨 크기들을 실제 크기(mm)로 A4 한 장(넘치면 여러 장)에 늘어놓는다. 라벨 바깥의 점선이 재단선, 양옆의 짧은 선이 접는 선이다.
// 일반 프린터로 인쇄해서 잘라 박스에 붙여 보는 용도라 프린터 용지 크기와 무관하다. 위쪽의 눈금자로 인쇄 배율이 100%인지 확인한다.
// 인쇄 대화상자가 닫히면(출력하거나 취소하면) onDone을 부른다.
export function LabelMockupPrinter({ job, onDone }: { job: LabelMockupJob | null; onDone: () => void }) {
  useEffect(() => {
    if (!job) return;
    const style = document.createElement('style');
    style.dataset.labelPrint = 'true';
    style.textContent = `
      #label-print-root { display: none; }
      @media print {
        body > *:not(#label-print-root) { display: none !important; }
        #label-print-root { display: block !important; }
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        #label-print-root, #label-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: A4 portrait; margin: ${PAGE_MARGIN_MM}mm; }
        .mockup-cell { break-inside: avoid; page-break-inside: avoid; }
      }`;
    document.head.appendChild(style);
    const finish = () => onDone();
    window.addEventListener('afterprint', finish, { once: true });
    // 막대(SVG)와 글자 맞춤이 끝난 뒤에 인쇄하도록 두 프레임을 기다린다.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', finish);
      style.remove();
    };
    // job이 바뀔 때만 한 번 인쇄한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  if (!job) return null;
  return createPortal(
    <div id="label-print-root" style={{ color: '#000', fontSize: '3.2mm' }}>
      <div style={{ fontWeight: 800, fontSize: '4mm' }}>라벨 시안 시트 — 인쇄 배율 100%(실제 크기)로 인쇄하세요</div>
      <div style={{ margin: '1.5mm 0 5mm' }}>
        <div style={{ position: 'relative', width: '100mm', height: '3mm', borderBottom: '0.3mm solid #000' }}>
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} style={{ position: 'absolute', left: `${i * 10}mm`, bottom: 0, height: i % 5 === 0 ? '3mm' : '1.8mm', borderLeft: '0.3mm solid #000' }} />
          ))}
        </div>
        <div style={{ fontSize: '2.8mm' }}>위 눈금자가 자로 재서 100mm가 아니면 인쇄 대화상자의 배율을 &lsquo;100%&rsquo; 또는 &lsquo;실제 크기&rsquo;로 바꾸세요. 점선 바깥을 따라 자르세요.</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6mm 4mm', alignItems: 'flex-start' }}>
        {job.sizes.map((size, index) => {
          const t = scaleTemplate(job.template, size);
          return (
            <div key={index} className="mockup-cell" style={{ padding: `0 ${TICK_MM + 1}mm` }}>
              <div style={{ fontSize: '2.8mm', fontWeight: 700, marginBottom: '1.2mm', whiteSpace: 'nowrap' }}>{mockupCaption(size)}</div>
              <div style={{ position: 'relative', width: `${t.widthMm}mm`, height: `${t.heightMm}mm`, outline: '0.25mm dashed #000', outlineOffset: '0.4mm' }}>
                <LabelView template={t} data={job.data} />
                {(['left', 'right'] as const).map((side) => (
                  <span key={side} style={{ position: 'absolute', top: `${t.topHeightMm}mm`, [side]: `-${TICK_MM + 1}mm`, width: `${TICK_MM}mm`, borderTop: '0.3mm solid #000' }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
