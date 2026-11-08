'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { makeQrMatrix, qrModuleMm } from '@/lib/labels/qr';
import { elementText, type LabelData, type LabelTemplate } from '@/lib/labels/template';

const PT_TO_MM = 25.4 / 72;
const MIN_FONT_MM = 8 * PT_TO_MM; // 줄바꿈하는 고정 문구는 이보다 작게 줄이지 않는다(넘치면 칸에서 잘린다)
const MIN_SINGLE_LINE_FONT_MM = 4 * PT_TO_MM; // 한 줄 항목(고객명 등)이 최소로 줄어드는 크기
const LINE_HEIGHT = 1.1;

// 글자가 칸(가로 widthMm × 세로 heightMm)에 들어가도록 글자 크기(mm)를 줄여 맞춘다. 설정한 크기가 상한이다.
//  - 한 줄 항목(singleLine: 고객명+박스번호, 터미널 등 값 항목): 절대 줄바꿈하지 않고, 한 줄이 칸 폭에 들어가도록 글자 크기만 줄인다.
//  - 고정 문구: 설정한 크기에서 시작해서 한 줄 또는 줄바꿈(띄어쓰기에서만, 한 단어가 칸보다 길면 글자 단위)으로 들어가는 가장 큰 크기를 고른다.
// 화면에 그려진 상자를 재지 않고 canvas로 글자 폭을 재서, 인쇄용으로 숨겨 둔(display:none) 라벨에서도 같은 결과가 나온다.
function fitFontMm(text: string, widthMm: number, heightMm: number, nominalMm: number, weight: number, family: string, singleLine: boolean): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !text) return nominalMm;
  ctx.font = `${weight} 100px ${family}`;
  const widthAt100 = (str: string) => ctx.measureText(str).width; // 100px(=100단위) 글자에서의 폭
  if (singleLine) {
    const byWidth = (widthMm * 0.98 * 100) / Math.max(widthAt100(text), 1); // 글자 크기(mm) × 폭 비율 = 글자 폭(mm)
    const byHeight = heightMm / LINE_HEIGHT;
    return Math.max(MIN_SINGLE_LINE_FONT_MM, Math.min(nominalMm, byWidth, byHeight));
  }
  const limit = widthMm * 0.96 * 100; // 100단위 기준 가로 한도(줄바꿈 오차 여유 4%)
  const lineCount = (fontMm: number): number => {
    const max = limit / fontMm; // 이 글자 크기에서 한 줄에 들어가는 폭(100단위 글자 기준)
    const space = widthAt100(' ');
    let lines = 1;
    let used = 0;
    for (const word of text.split(' ').filter(Boolean)) {
      const w = widthAt100(word);
      if (w > max) {
        // 단어 하나가 한 줄보다 길면 글자 단위로 나눈다.
        for (const ch of word) {
          const cw = widthAt100(ch);
          if (used > 0 && used + cw > max) { lines++; used = 0; }
          used += cw;
        }
        used += space;
        continue;
      }
      if (used > 0 && used + w > max) { lines++; used = 0; }
      used += w + space;
    }
    return lines;
  };
  for (let f = nominalMm; f > MIN_FONT_MM; f -= 0.1) {
    if (lineCount(f) * f * LINE_HEIGHT <= heightMm + 0.05) return f;
  }
  return MIN_FONT_MM;
}

const u0 = (mm: number, unit: string) => `calc(${mm} * ${unit})`;

function FitText({ text, widthMm, heightMm, nominalMm, bold, unit, singleLine }: { text: string; widthMm: number; heightMm: number; nominalMm: number; bold: boolean; unit: string; singleLine: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const span = ref.current;
    if (!span) return;
    const fit = () => {
      const f = fitFontMm(text, widthMm, heightMm, nominalMm, bold ? 800 : 500, getComputedStyle(span).fontFamily, singleLine);
      span.style.fontSize = `calc(${f} * ${unit})`;
    };
    fit();
    // 웹폰트가 늦게 로드되면 글자 폭이 달라지므로 로드 후 다시 맞춘다.
    void document.fonts?.ready.then(fit);
  }, [text, widthMm, heightMm, nominalMm, bold, unit, singleLine]);
  return <span ref={ref} style={{ maxWidth: '100%', fontSize: u0(nominalMm, unit), whiteSpace: singleLine ? 'nowrap' : undefined }}>{text}</span>;
}

// QR 코드를 그린다. 상자(widthMm × heightMm) 안에서 정사각형으로, 가운데에, 칸 크기를 프린터 도트의 정수배로 맞춰 그린다
// (qrModuleMm). 흰 여백(quiet zone, 4칸)은 상자 밖에 비워 두어야 하며 디자인에서 지킨다. 좌표는 mm, 화면 배율은 SVG가 맞춘다.
function QrCode({ value, widthMm, heightMm }: { value: string; widthMm: number; heightMm: number }) {
  const matrix = useMemo(() => makeQrMatrix(value), [value]);
  const mod = qrModuleMm(Math.min(widthMm, heightMm), matrix.size);
  const side = mod * matrix.size;
  const x0 = (widthMm - side) / 2;
  const y0 = (heightMm - side) / 2;
  const cells: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) if (matrix.dark[r * matrix.size + c]) cells.push(`M${c} ${r}h1v1h-1z`);
  }
  return (
    <svg viewBox={`0 0 ${widthMm} ${heightMm}`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ display: 'block', width: '100%', height: '100%' }}>
      <g transform={`translate(${x0} ${y0}) scale(${mod})`}>
        <path d={cells.join('')} fill="#000" />
      </g>
    </svg>
  );
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
          return <div key={el.id} style={box}><QrCode value={data.barcode} widthMm={el.w} heightMm={el.h} /></div>;
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
              lineHeight: LINE_HEIGHT,
              fontWeight: el.bold ? 800 : 500,
              textAlign: el.align ?? 'left',
              overflow: 'hidden',
              ...(el.type === 'field' ? { whiteSpace: 'nowrap' as const } : { wordBreak: 'keep-all' as const, overflowWrap: 'anywhere' as const }),
            }}
          >
            <FitText text={text} widthMm={el.w} heightMm={el.h} nominalMm={fontMm} bold={el.bold === true} unit={unit} singleLine={el.type === 'field'} />
          </div>
        );
      })}
    </div>
  );
}
