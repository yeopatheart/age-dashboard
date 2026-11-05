// 바코드 스캔 시험용: 프린터는 203dpi라서 1도트가 약 0.125mm다. 바코드 막대 한 칸(module)이 도트 수의 정수 배일 때 가장 또렷하고,
// 소수(예: 6.08도트)면 칸마다 6도트·7도트로 들쭉날쭉해진다. 막대가 가는 라벨일수록 스캔율에 영향이 크다.
// 12자리 숫자 Code128은 막대 101칸이고 좌우 여백(label-view의 BarcodeBars)이 10칸씩이라 상자 가로 폭이 121칸이다(JsBarcode로 확인).
import type { LabelElement, LabelTemplate } from './template';

export const PRINTER_DPI = 203; // TSC TE210
export const DOT_MM = 25.4 / PRINTER_DPI;
export const BARCODE_BOX_MODULES = 121;

const round2 = (v: number) => Math.round(v * 100) / 100;

export const moduleMm = (boxWidthMm: number) => boxWidthMm / BARCODE_BOX_MODULES;
export const moduleDots = (boxWidthMm: number) => moduleMm(boxWidthMm) / DOT_MM;
// 막대 한 칸이 정확히 dots 도트가 되는 바코드 상자 가로 폭(mm)
export const boxWidthForDots = (dots: number) => round2(BARCODE_BOX_MODULES * dots * DOT_MM);

const TEST_DOTS = [2, 3, 4, 5, 6];
const SIDE_PAD_MM = 4;
const TOP_PAD_MM = 2;
const CAPTION_MM = 3.2;

// 같은 12자리 바코드를 막대 한 칸 2·3·4·5·6도트로 한 장에 찍는 시험 라벨. 라벨 크기는 지금 디자인과 같아서(프린터 용지 설정 그대로)
// 용지에 안 들어가는 굵기는 뺀다. 폰 카메라로 각 줄을 스캔해서 읽히는 가장 가는 줄을 찾는다.
export function barcodeTestTemplate(base: LabelTemplate): LabelTemplate {
  const dotsList = TEST_DOTS.filter((d) => boxWidthForDots(d) <= base.widthMm - SIDE_PAD_MM * 2);
  const rowMm = (base.heightMm - TOP_PAD_MM * 2) / Math.max(dotsList.length, 1);
  const elements: LabelElement[] = dotsList.flatMap((dots, i): LabelElement[] => {
    const y = TOP_PAD_MM + i * rowMm;
    const w = boxWidthForDots(dots);
    return [
      { id: `t-cap-${dots}`, type: 'text', text: `${dots}도트 · 막대 ${round2(w / BARCODE_BOX_MODULES)}mm`, x: SIDE_PAD_MM, y, w: base.widthMm - SIDE_PAD_MM * 2, h: CAPTION_MM, fontSize: 7, bold: true, align: 'left' },
      { id: `t-bar-${dots}`, type: 'barcode', x: SIDE_PAD_MM, y: round2(y + CAPTION_MM + 0.2), w, h: round2(rowMm - CAPTION_MM - 1), showText: false },
    ];
  });
  return { ...base, elements };
}
