'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LabelView } from './label-view';
import type { LabelData, LabelTemplate } from '@/lib/labels/template';

export interface LabelPrintJob {
  template: LabelTemplate;
  labels: LabelData[];
}

// 라벨을 한 장씩 한 페이지로 인쇄한다. 화면의 다른 요소는 인쇄에서 숨기고, 페이지 크기를 라벨 크기(mm)에 맞춘다.
// 프린터 드라이버의 용지 크기가 라벨 크기와 같아야 한다(Windows 인쇄 대화상자에서 용지를 라벨 크기로 선택).
// 인쇄 대화상자가 닫히면(출력하거나 취소하면) onDone을 부른다.
export function LabelPrinter({ job, onDone }: { job: LabelPrintJob | null; onDone: () => void }) {
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
        @page { size: ${job.template.widthMm}mm ${job.template.heightMm}mm; margin: 0; }
        .label-page { width: ${job.template.widthMm}mm; height: ${job.template.heightMm}mm; break-after: page; page-break-after: always; overflow: hidden; }
        .label-page:last-child { break-after: auto; page-break-after: auto; }
      }`;
    document.head.appendChild(style);
    const finish = () => onDone();
    window.addEventListener('afterprint', finish, { once: true });
    // 막대(SVG)가 그려진 뒤에 인쇄하도록 두 프레임을 기다린다.
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
    <div id="label-print-root">
      {job.labels.map((data, index) => (
        <div key={index} className="label-page">
          <LabelView template={job.template} data={data} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
