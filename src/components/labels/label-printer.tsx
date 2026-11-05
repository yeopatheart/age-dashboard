'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LabelView } from './label-view';
import type { LabelData, LabelTemplate } from '@/lib/labels/template';

export interface LabelPrintJob {
  template: LabelTemplate;
  labels: LabelData[];
  // 롤 방향에 맞춰 라벨을 시계 방향으로 90도 돌려 출력한다. 용지(드라이버)는 높이×가로로 바뀐다(예: 100×80 라벨 → 80×100 용지).
  rotate?: boolean;
}

// 라벨을 한 장씩 한 페이지로 인쇄한다. 화면의 다른 요소는 인쇄에서 숨기고, 페이지 크기를 라벨 크기(mm)에 맞춘다.
// 프린터 드라이버의 용지 크기가 라벨 크기와 같아야 한다(Windows 인쇄 대화상자에서 용지를 라벨 크기로 선택).
// 인쇄 대화상자가 닫히면(출력하거나 취소하면) onDone을 부른다.
export function LabelPrinter({ job, onDone }: { job: LabelPrintJob | null; onDone: () => void }) {
  useEffect(() => {
    if (!job) return;
    const { widthMm, heightMm } = job.template;
    // 돌려서 출력하면 용지는 높이×가로이고, 라벨(가로×높이)을 왼쪽 위 모서리 기준으로 90도 돌린 뒤 용지 안으로 밀어 넣는다.
    const pageW = job.rotate ? heightMm : widthMm;
    const pageH = job.rotate ? widthMm : heightMm;
    const style = document.createElement('style');
    style.dataset.labelPrint = 'true';
    style.textContent = `
      #label-print-root { display: none; }
      @media print {
        body > *:not(#label-print-root) { display: none !important; }
        #label-print-root { display: block !important; }
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        #label-print-root, #label-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
        .label-page { position: relative; width: ${pageW}mm; height: ${pageH}mm; break-after: page; page-break-after: always; overflow: hidden; }
        .label-page:last-child { break-after: auto; page-break-after: auto; }
        .label-rot { position: absolute; left: 0; top: 0; width: ${widthMm}mm; height: ${heightMm}mm; transform-origin: 0 0; transform: translate(${heightMm}mm, 0) rotate(90deg); }
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
          <div className={job.rotate ? 'label-rot' : undefined}>
            <LabelView template={job.template} data={data} />
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
