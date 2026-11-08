// 박스 라벨의 QR 코드. 내용은 박스 번호(숫자 12자리)이며, 12자리 숫자는 버전 1(21×21칸)에 오류 정정 H(약 30% 복원)로도 들어간다.
// 칸 배열만 만들고 그리는 일은 label-view가 한다 — 프린터 도트(203dpi)의 정수배로 칸 크기를 맞추려고 직접 그린다.
import QRCode from 'qrcode';

export const PRINTER_DPI = 203; // TSC TE210
export const DOT_MM = 25.4 / PRINTER_DPI;

export interface QrMatrix {
  size: number; // 한 변의 칸 수
  dark: boolean[]; // size × size, 행 우선
}

export function makeQrMatrix(text: string): QrMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'H' });
  return { size: modules.size, dark: Array.from(modules.data, (v) => v === 1) };
}

// 칸 한 개를 프린터 도트의 정수배로 만든다. 소수 배(예: 6.08도트)면 칸마다 6도트·7도트로 들쭉날쭉해져 인식률이 떨어진다.
// 상자(mm) 안에 들어가는 가장 큰 정수 도트 수를 쓰되, 상자 크기를 mm로 적다 보면 생기는 아주 작은 모자람(0.05도트 ≈ 칸당 0.006mm)은 올려서 쓴다
// (21mm 상자의 칸 1.0mm는 7.99도트라서 7도트로 내리면 QR이 18.4mm로 줄어든다). 상자가 너무 작아 1도트도 안 되면 상자에 맞춘 값을 그대로 쓴다.
const DOT_TOLERANCE = 0.05;
export function qrModuleMm(boxMm: number, modules: number): number {
  const fit = boxMm / modules;
  const dots = Math.floor(fit / DOT_MM + DOT_TOLERANCE);
  return dots >= 1 ? dots * DOT_MM : fit;
}

export const qrModuleDots = (moduleMm: number) => moduleMm / DOT_MM;
