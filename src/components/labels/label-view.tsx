'use client';
import { useLayoutEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { elementText, type LabelData, type LabelTemplate } from '@/lib/labels/template';

const PT_TO_MM = 25.4 / 72;

// Code128 막대만 그린다(숫자는 아래에서 HTML 글자로 따로 찍는다 — 막대를 늘일 때 글자가 같이 찌그러지지 않게).
// 막대 폭은 상자에 맞춰 가로로 늘어나도 비율이 유지된다. 좌우 여백(quiet zone)은 스캐너가 읽는 데 필요해서 막대 폭의 10배를 둔다.
function BarcodeBars({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    try {
      JsBarcode(svg, value, { format: 'CODE128', displayValue: false, width: 2, height: 100, margin: 0, marginLeft: 20, marginRight: 20, background: '#ffffff', lineColor: '#000000' });
    } catch {
      svg.replaceChildren();
      return;
    }
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'none');
  }, [value]);
  return <svg ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
}

// 라벨 한 장. 좌표·크기는 mm이고, unit(CSS 길이)로 화면 배율을 정한다: 인쇄는 '1mm', 디자이너 화면은 '4px'처럼.
export function LabelView({
  template,
  data,
  unit = '1mm',
}: {
  template: LabelTemplate;
  data: LabelData;
  unit?: string;
}) {
  const u = (mm: number) => `calc(${mm} * ${unit})`;
  return (
    <div style={{ position: 'relative', width: u(template.widthMm), height: u(template.heightMm), background: '#fff', color: '#000', overflow: 'hidden', fontFamily: 'inherit' }}>
      {template.elements.map((el) => {
        const box: React.CSSProperties = { position: 'absolute', left: u(el.x), top: u(el.y), width: u(el.w), height: u(el.h) };
        if (el.type === 'line') {
          return <div key={el.id} style={{ ...box, background: '#000' }}></div>;
        }
        if (el.type === 'barcode') {
          const textMm = el.showText === false ? 0 : Math.min(4.2, el.h * 0.28);
          return (
            <div key={el.id} style={{ ...box, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0 }}><BarcodeBars value={data.barcode} /></div>
              {textMm > 0 && (
                <div style={{ height: u(textMm), fontSize: u(textMm * 0.85), lineHeight: u(textMm), textAlign: 'center', letterSpacing: u(0.25), fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>{data.barcode}</div>
              )}
            </div>
          );
        }
        const text = elementText(el, data);
        const fontMm = (el.fontSize ?? 12) * PT_TO_MM;
        return (
          <div
            key={el.id}
            style={{
              ...box,
              display: 'flex',
              alignItems: 'center',
              justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
              fontSize: u(fontMm),
              lineHeight: 1.1,
              fontWeight: el.bold ? 800 : 500,
              textAlign: el.align ?? 'left',
              overflow: 'hidden',
              wordBreak: 'keep-all',
              overflowWrap: 'anywhere',
            }}
          >
            <span style={{ maxWidth: '100%' }}>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
