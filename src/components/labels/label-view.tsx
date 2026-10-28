'use client';
import { useLayoutEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { elementText, type LabelData, type LabelTemplate } from '@/lib/labels/template';

const PT_TO_MM = 25.4 / 72;
const MIN_FONT_MM = 8 * PT_TO_MM; // 이보다 작게 줄이지는 않는다(넘치면 칸에서 잘린다)
const LINE_HEIGHT = 1.1;

// 글자가 칸(가로 widthMm × 세로 heightMm)에 들어가도록 글자 크기(mm)를 줄여 맞춘다: 설정한 크기에서 시작해서
// 한 줄 또는 줄바꿈(띄어쓰기에서만, 한 단어가 칸보다 길면 글자 단위)으로 들어가는 가장 큰 크기를 고른다.
// 화면에 그려진 상자를 재지 않고 canvas로 글자 폭을 재서, 인쇄용으로 숨겨 둔(display:none) 라벨에서도 같은 결과가 나온다.
function fitFontMm(text: string, widthMm: number, heightMm: number, nominalMm: number, weight: number, family: string): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !text) return nominalMm;
  ctx.font = `${weight} 100px ${family}`;
  const widthAt100 = (str: string) => ctx.measureText(str).width; // 100px(=100단위) 글자에서의 폭
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

function FitText({ text, widthMm, heightMm, nominalMm, bold, unit }: { text: string; widthMm: number; heightMm: number; nominalMm: number; bold: boolean; unit: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const span = ref.current;
    if (!span) return;
    const fit = () => {
      const f = fitFontMm(text, widthMm, heightMm, nominalMm, bold ? 800 : 500, getComputedStyle(span).fontFamily);
      span.style.fontSize = `calc(${f} * ${unit})`;
    };
    fit();
    // 웹폰트가 늦게 로드되면 글자 폭이 달라지므로 로드 후 다시 맞춘다.
    void document.fonts?.ready.then(fit);
  }, [text, widthMm, heightMm, nominalMm, bold, unit]);
  return <span ref={ref} style={{ maxWidth: '100%', fontSize: u0(nominalMm, unit) }}>{text}</span>;
}

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
              lineHeight: LINE_HEIGHT,
              fontWeight: el.bold ? 800 : 500,
              textAlign: el.align ?? 'left',
              overflow: 'hidden',
              wordBreak: 'keep-all',
              overflowWrap: 'anywhere',
            }}
          >
            <FitText text={text} widthMm={el.w} heightMm={el.h} nominalMm={fontMm} bold={el.bold === true} unit={unit} />
          </div>
        );
      })}
    </div>
  );
}
