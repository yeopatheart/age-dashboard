// QR 스캔 시험용: 프린터는 203dpi라서 1도트가 약 0.125mm다. QR 한 칸(module)이 도트 수의 정수배일 때 가장 또렷하다.
// 같은 QR을 칸당 3·4·5·6·8·10도트로 한 장에 찍고, 폰 카메라로 각각 스캔해서 읽히는 가장 작은 크기를 찾는다.
import { DOT_MM } from './qr';
import type { LabelElement, LabelTemplate } from './template';

const MODULES = 21; // 12자리 숫자 QR(버전 1)
const TEST_DOTS = [3, 4, 5, 6, 8, 10];
const PAD_MM = 4;
const QUIET_MM = 4; // QR 사이 간격(흰 여백)
const CAPTION_MM = 3.2;

const round2 = (v: number) => Math.round(v * 100) / 100;
export const qrSizeMm = (dots: number) => round2(MODULES * dots * DOT_MM);

// 라벨 크기는 지금 디자인과 같다(프린터 용지 설정 그대로). 왼쪽에서 오른쪽으로 채우다가 폭이 모자라면 다음 줄로 내려가고,
// 라벨 높이를 넘는 크기는 뺀다.
export function qrTestTemplate(base: LabelTemplate): LabelTemplate {
  const elements: LabelElement[] = [];
  let x = PAD_MM;
  let y = PAD_MM;
  let rowH = 0;
  for (const dots of TEST_DOTS) {
    const size = qrSizeMm(dots);
    const width = Math.max(size, 22); // 캡션이 들어갈 최소 폭
    if (x + width > base.widthMm - PAD_MM + 0.01) {
      x = PAD_MM;
      y += rowH + QUIET_MM;
      rowH = 0;
    }
    if (y + size + CAPTION_MM > base.heightMm - PAD_MM) continue;
    elements.push(
      { id: `t-qr-${dots}`, type: 'barcode', x: round2(x), y: round2(y), w: size, h: size },
      { id: `t-cap-${dots}`, type: 'text', text: `${dots}도트 · ${round2(size)}mm`, x: round2(x), y: round2(y + size + 0.4), w: width, h: CAPTION_MM, fontSize: 7, bold: true, align: 'left' },
    );
    x += width + QUIET_MM;
    rowH = Math.max(rowH, size + CAPTION_MM + 0.4);
  }
  return { ...base, elements };
}
