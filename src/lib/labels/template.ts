// 송장 라벨 디자인(크기·항목 배치)의 타입, 기본값, 검증. DB 접근은 넣지 않는다(서버·클라이언트 모두 사용).
// 라벨은 한 종류다: 박스 뚜껑 모서리에 감아 붙이는 한 장짜리(wrap-around). 위쪽 부분(상단 면)은 뚜껑 위에,
// 아래쪽 부분(측면)은 뚜껑 옆면으로 꺾어 내려 붙인다. 접히는 선(상단 면 높이 위치) 양쪽 FOLD_KEEP_OUT_MM에는 글자·바코드를 두지 않는다.
// 좌표·크기 단위는 모두 mm.
export const LABEL_TEMPLATE_KEY = 'label'; // label_templates / box_label_events에 저장하는 종류 값
export const FOLD_KEEP_OUT_MM = 2;

// 라벨에 채워 넣을 수 있는 값. 항목(element)이 field로 이 중 하나를 고른다.
export const LABEL_FIELDS = {
  terminal: '터미널명',
  separate: '별도주문 구분',
  businessBox: '고객명+박스번호',
  date: '날짜',
  company: '상호',
  contact: '연락처',
  barcodeNumber: '바코드 번호(숫자)',
} as const;
export type LabelField = keyof typeof LABEL_FIELDS;

export type LabelElementType = 'text' | 'field' | 'barcode' | 'line';
export const ELEMENT_TYPE_NAMES: Record<LabelElementType, string> = { text: '고정 문구', field: '항목', barcode: '바코드', line: '구분선' };

export interface LabelElement {
  id: string;
  type: LabelElementType;
  field?: LabelField; // type=field
  text?: string; // type=text
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number; // pt (text·field)
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  showText?: boolean; // type=barcode: 바코드 아래에 숫자도 같이 찍는다
}

export interface LabelTemplate {
  widthMm: number;
  heightMm: number; // 전체 높이 = 상단 면 + 측면 (프린터 용지 높이와 같다)
  topHeightMm: number; // 상단 면 높이. 이 위치가 접히는 선이다. 측면 높이 = heightMm - topHeightMm
  sideWidthMm: number; // 측면에 붙는 폭(옆면이 라벨보다 좁을 때). 측면 영역에서 가운데 이 폭 밖은 쓰지 않는다
  elements: LabelElement[];
}

export const sideHeightMm = (t: Pick<LabelTemplate, 'heightMm' | 'topHeightMm'>) => t.heightMm - t.topHeightMm;
// 측면 폭 밖(좌우)과 접히는 선 주변은 쓸 수 없다. 항목이 쓸 수 없는 곳에 걸쳐 있는지 알려 준다.
export function elementProblem(el: Pick<LabelElement, 'x' | 'y' | 'w' | 'h'>, t: LabelTemplate): 'fold' | 'side-width' | null {
  const foldTop = t.topHeightMm - FOLD_KEEP_OUT_MM;
  const foldBottom = t.topHeightMm + FOLD_KEEP_OUT_MM;
  if (el.y < foldBottom && el.y + el.h > foldTop) return 'fold';
  if (el.y + el.h > foldBottom - 0.01 && t.sideWidthMm < t.widthMm) {
    const left = (t.widthMm - t.sideWidthMm) / 2;
    if (el.x < left - 0.01 || el.x + el.w > left + t.sideWidthMm + 0.01) return 'side-width';
  }
  return null;
}

// 라벨 한 장에 채우는 실제 값
export interface LabelData {
  terminal: string;
  separate: boolean; // 별도 주문(택배·화물 등)인지
  business: string;
  boxNo: number;
  date: string; // YYYY-MM-DD
  company: string;
  contact: string;
  barcode: string;
}

export function fieldText(field: LabelField, data: LabelData): string {
  switch (field) {
    case 'terminal': return data.terminal;
    case 'separate': return data.separate ? '별도주문' : '';
    case 'businessBox': return `${data.business} #${data.boxNo}`;
    case 'date': return data.date.replaceAll('-', '.');
    case 'company': return data.company;
    case 'contact': return data.contact;
    case 'barcodeNumber': return data.barcode;
  }
}

// 박스 번호는 전체 박스 수를 쓰지 않고 번호만 찍는다(박스가 늘어도 이미 붙인 라벨을 다시 붙이지 않게).
// 고객명과 박스 번호는 한 항목("고객명 #번호")이다 — 이름 길이에 따라 글자 크기를 자동으로 맞춘다(label-view의 FitText).
export const DEFAULT_TEMPLATE: LabelTemplate = {
  widthMm: 100,
  heightMm: 80,
  topHeightMm: 60,
  sideWidthMm: 100,
  elements: [
    // 상단 면 (y 0~60, 접히는 선 주변 58~62는 비워 둔다)
    { id: 'w-terminal', type: 'field', field: 'terminal', x: 4, y: 3, w: 58, h: 12, fontSize: 26, bold: true, align: 'left' },
    { id: 'w-date', type: 'field', field: 'date', x: 62, y: 4, w: 34, h: 8, fontSize: 13, bold: false, align: 'right' },
    { id: 'w-business', type: 'field', field: 'businessBox', x: 4, y: 16, w: 92, h: 13, fontSize: 28, bold: true, align: 'left' },
    { id: 'w-barcode-top', type: 'barcode', x: 4, y: 31, w: 92, h: 17, showText: true },
    { id: 'w-line', type: 'line', x: 4, y: 49.5, w: 92, h: 0.4 },
    { id: 'w-company', type: 'field', field: 'company', x: 4, y: 50.5, w: 46, h: 7, fontSize: 12, bold: true, align: 'left' },
    { id: 'w-contact', type: 'field', field: 'contact', x: 50, y: 50.5, w: 46, h: 7, fontSize: 12, bold: false, align: 'right' },
    // 측면 (y 60~80, 접히는 선 주변 62까지 비움, 아래 가장자리는 프린터 출력 여백)
    { id: 'w-barcode-side', type: 'barcode', x: 4, y: 62.5, w: 60, h: 14, showText: true },
    { id: 'w-business-side', type: 'field', field: 'businessBox', x: 66, y: 64, w: 30, h: 11, fontSize: 14, bold: true, align: 'right' },
  ],
};

const clampNum = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// DB(jsonb)에서 읽은 값을 안전한 항목 배열로 만든다. 알 수 없는 값은 버리거나 기본값으로 바꾼다.
export function parseElements(value: unknown): LabelElement[] {
  if (!Array.isArray(value)) return [];
  const out: LabelElement[] = [];
  value.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) return;
    const r = raw as Record<string, unknown>;
    const type = r.type;
    if (type !== 'text' && type !== 'field' && type !== 'barcode' && type !== 'line') return;
    const field = typeof r.field === 'string' && r.field in LABEL_FIELDS ? (r.field as LabelField) : undefined;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `e-${index}`,
      type,
      field: type === 'field' ? field ?? 'businessBox' : undefined,
      text: type === 'text' ? String(r.text ?? '') : undefined,
      x: clampNum(r.x, 0, 0, 300),
      y: clampNum(r.y, 0, 0, 300),
      w: clampNum(r.w, 20, 0.2, 300),
      h: clampNum(r.h, 8, 0.2, 300),
      fontSize: type === 'text' || type === 'field' ? clampNum(r.fontSize, 12, 4, 120) : undefined,
      bold: type === 'text' || type === 'field' ? r.bold === true : undefined,
      align: r.align === 'center' || r.align === 'right' ? r.align : 'left',
      showText: type === 'barcode' ? r.showText !== false : undefined,
    });
  });
  return out;
}

export function buildTemplate(row: { width_mm: number | string; height_mm: number | string; top_height_mm?: number | string | null; side_width_mm?: number | string | null; elements: unknown } | null | undefined): LabelTemplate {
  const fallback = DEFAULT_TEMPLATE;
  if (!row) return fallback;
  const widthMm = clampNum(row.width_mm, fallback.widthMm, 20, 300);
  const heightMm = clampNum(row.height_mm, fallback.heightMm, 20, 300);
  return {
    widthMm,
    heightMm,
    topHeightMm: clampNum(row.top_height_mm, Math.min(fallback.topHeightMm, heightMm - 8), 10, heightMm - 8),
    sideWidthMm: clampNum(row.side_width_mm, widthMm, 10, widthMm),
    elements: parseElements(row.elements),
  };
}

// 항목에 실제로 찍는 글자(고정 문구는 text, 항목은 라벨 값)
export function elementText(el: LabelElement, data: LabelData): string {
  if (el.type === 'text') return el.text ?? '';
  if (el.type === 'field' && el.field) return fieldText(el.field, data);
  return '';
}

// 디자이너와 테스트 출력에서 쓰는 예시 값
export const SAMPLE_LABEL_DATA: LabelData = {
  terminal: '남부',
  separate: false,
  business: '스시고유',
  boxNo: 2,
  date: '2026-10-28',
  company: '통영아재수산',
  contact: '055-000-0000',
  barcode: '261028012035',
};
