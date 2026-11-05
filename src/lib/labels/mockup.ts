// 라벨 시안 시트(A4)용: 지금 디자인을 다른 라벨 크기로 비례해서 늘이거나 줄인다. 프린터·롤이 정해져 있어도
// 종이로 크기·배치를 먼저 거르기 위한 것이다(스캔·내구성 같은 열전사 특성은 실물로 따로 확인한다).
// 순수 함수라서 화면·DB와 무관하다. 좌표·크기 단위는 모두 mm.
import { FOLD_KEEP_OUT_MM, type LabelElement, type LabelTemplate } from './template';

export interface MockupSize {
  widthMm: number;
  heightMm: number; // 전체 높이 = 상단 면 + 측면
  topHeightMm: number;
}

// 현장 시험에서 비교해 볼 만한 크기. 상단 면이 전체의 약 3/4이다(지금 100×80 라벨의 60/80과 같은 비율).
export const DEFAULT_MOCKUP_SIZES: MockupSize[] = [
  { widthMm: 100, heightMm: 60, topHeightMm: 45 },
  { widthMm: 80, heightMm: 60, topHeightMm: 45 },
  { widthMm: 70, heightMm: 50, topHeightMm: 38 },
];

export const sizeOf = (t: LabelTemplate): MockupSize => ({ widthMm: t.widthMm, heightMm: t.heightMm, topHeightMm: t.topHeightMm });

export const mockupCaption = (s: MockupSize) => `${s.widthMm}×${s.heightMm}mm · 상단 ${s.topHeightMm} / 측면 ${s.heightMm - s.topHeightMm}`;

const MIN_FONT_PT = 4;
const MIN_LINE_MM = 0.3; // 구분선은 두께를 비례로 줄이면 안 찍히므로 최소 두께를 둔다

// 상단 면(접히는 선 위)과 측면(아래)은 높이 배율을 따로 적용한다: 각 면에 놓인 항목은 그 면 안에서 같은 비율로 움직인다.
// 접히는 선 양쪽 FOLD_KEEP_OUT_MM(비워 두는 구역)은 줄이지 않고 그대로 두고, 그 바깥의 쓸 수 있는 높이만 비례로 바꾼다.
// 그래야 줄인 라벨에서도 글자·바코드가 접히는 곳에 걸리지 않는다.
// 가로 배율과 면 높이 배율 중 작은 쪽으로 글자 크기를 줄여서 비율이 크게 틀어져도 글자가 칸을 넘지 않게 한다.
export function scaleTemplate(t: LabelTemplate, s: MockupSize): LabelTemplate {
  const sx = s.widthMm / t.widthMm;
  const topScale = (s.topHeightMm - FOLD_KEEP_OUT_MM) / (t.topHeightMm - FOLD_KEEP_OUT_MM);
  const sideScale = (s.heightMm - s.topHeightMm - FOLD_KEEP_OUT_MM) / (t.heightMm - t.topHeightMm - FOLD_KEEP_OUT_MM);
  const elements = t.elements.map((el): LabelElement => {
    const onTop = el.y + el.h / 2 < t.topHeightMm; // 항목 가운데가 접히는 선 위면 상단 면
    const sy = onTop ? topScale : sideScale;
    const y = onTop ? el.y * sy : s.topHeightMm + FOLD_KEEP_OUT_MM + (el.y - t.topHeightMm - FOLD_KEEP_OUT_MM) * sy;
    return {
      ...el,
      x: round2(el.x * sx),
      y: round2(y),
      w: round2(el.w * sx),
      h: round2(el.type === 'line' ? Math.max(el.h, MIN_LINE_MM) : el.h * sy),
      fontSize: el.fontSize === undefined ? undefined : Math.max(MIN_FONT_PT, round2(el.fontSize * Math.min(sx, sy))),
    };
  });
  return { widthMm: s.widthMm, heightMm: s.heightMm, topHeightMm: s.topHeightMm, sideWidthMm: round2(t.sideWidthMm * sx), elements };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
