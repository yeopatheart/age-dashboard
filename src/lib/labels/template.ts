// 송장 라벨 디자인(크기·항목 배치)의 타입, 기본값, 검증. DB 접근은 넣지 않는다(서버·클라이언트 모두 사용).
// 라벨은 2종이다: top = 박스 뚜껑 상단, side = 박스 뚜껑 측면. 좌표·크기 단위는 모두 mm.
export type LabelKind = 'top' | 'side';
export const LABEL_KIND_NAMES: Record<LabelKind, string> = { top: '박스 상단 라벨', side: '박스 측면 라벨' };

// 라벨에 채워 넣을 수 있는 값. 항목(element)이 field로 이 중 하나를 고른다.
export const LABEL_FIELDS = {
  terminal: '터미널명',
  separate: '별도주문 구분',
  business: '고객사명',
  boxNo: '박스번호',
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
  kind: LabelKind;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
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
    case 'business': return data.business;
    case 'boxNo': return String(data.boxNo);
    case 'date': return data.date.replaceAll('-', '.');
    case 'company': return data.company;
    case 'contact': return data.contact;
    case 'barcodeNumber': return data.barcode;
  }
}

// 박스 번호는 전체 박스 수를 쓰지 않고 번호만 찍는다(박스가 늘어도 이미 붙인 라벨을 다시 붙이지 않게).
export const DEFAULT_TEMPLATES: Record<LabelKind, LabelTemplate> = {
  top: {
    kind: 'top',
    widthMm: 100,
    heightMm: 80,
    elements: [
      { id: 't-terminal', type: 'field', field: 'terminal', x: 4, y: 3, w: 58, h: 14, fontSize: 30, bold: true, align: 'left' },
      { id: 't-date', type: 'field', field: 'date', x: 62, y: 4, w: 34, h: 8, fontSize: 13, bold: false, align: 'right' },
      { id: 't-business', type: 'field', field: 'business', x: 4, y: 19, w: 68, h: 16, fontSize: 24, bold: true, align: 'left' },
      { id: 't-boxno', type: 'field', field: 'boxNo', x: 74, y: 17, w: 22, h: 20, fontSize: 44, bold: true, align: 'center' },
      { id: 't-barcode', type: 'barcode', x: 4, y: 39, w: 92, h: 26, showText: true },
      { id: 't-line', type: 'line', x: 4, y: 67, w: 92, h: 0.4 },
      { id: 't-company', type: 'field', field: 'company', x: 4, y: 69, w: 46, h: 8, fontSize: 13, bold: true, align: 'left' },
      { id: 't-contact', type: 'field', field: 'contact', x: 50, y: 69, w: 46, h: 8, fontSize: 13, bold: false, align: 'right' },
    ],
  },
  side: {
    kind: 'side',
    widthMm: 100,
    heightMm: 40,
    elements: [
      { id: 's-business', type: 'field', field: 'business', x: 3, y: 2, w: 70, h: 13, fontSize: 22, bold: true, align: 'left' },
      { id: 's-boxno', type: 'field', field: 'boxNo', x: 74, y: 1, w: 23, h: 15, fontSize: 34, bold: true, align: 'center' },
      { id: 's-barcode', type: 'barcode', x: 3, y: 17, w: 94, h: 21, showText: true },
    ],
  },
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
      field: type === 'field' ? field ?? 'business' : undefined,
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

export function buildTemplate(kind: LabelKind, row: { width_mm: number | string; height_mm: number | string; elements: unknown } | null | undefined): LabelTemplate {
  const fallback = DEFAULT_TEMPLATES[kind];
  if (!row) return fallback;
  return {
    kind,
    widthMm: clampNum(row.width_mm, fallback.widthMm, 20, 300),
    heightMm: clampNum(row.height_mm, fallback.heightMm, 10, 300),
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
