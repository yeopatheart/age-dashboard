// 송장 라벨 디자인(크기·항목 배치)의 타입, 기본값, 검증. DB 접근은 넣지 않는다(서버·클라이언트 모두 사용).
// 라벨 디자인은 여러 개를 저장해 두고(label_designs) 그중 하나를 "사용 중"으로 골라 출력한다.
// 접는선(fold)은 항목의 한 종류다: 있으면 박스 뚜껑 모서리에 감아 붙이는 한 장짜리(접는선 위 = 뚜껑 위, 아래 = 옆면으로 꺾음),
// 없으면 전체가 윗면에만 붙는 평평한 라벨이다. 접는선 양쪽 FOLD_KEEP_OUT_MM에는 글자·QR을 두지 않는다. 인쇄되는 선은 아니다.
// 좌표·크기 단위는 모두 mm.
export const LABEL_TEMPLATE_KEY = 'label'; // box_label_events에 남기는 라벨 종류 값(출력 이력)
export const FOLD_KEEP_OUT_MM = 2;

// 라벨에 채워 넣을 수 있는 값. 항목(element)이 field로 이 중 하나를 고른다.
export const LABEL_FIELDS = {
  terminal: '터미널명',
  separate: '별도주문 구분',
  businessBox: '고객명+박스번호',
  date: '날짜',
  company: '상호',
  contact: '연락처',
  barcodeNumber: '번호(숫자 12자리)',
  merge: '합포장 표시',
} as const;
export type LabelField = keyof typeof LABEL_FIELDS;

// 'barcode'는 QR 코드 항목이다. 이미 저장된 디자인(jsonb)과 이름을 맞추려고 값은 그대로 두었다(화면에는 "QR 코드"로 보인다).
// 'fold'는 접는선이다: y = 접는 위치, w = 옆면에 붙는 폭(가운데 기준, x는 저장할 때 맞춘다), h = 0. 한 디자인에 하나만 둘 수 있고 인쇄하지 않는다.
export type LabelElementType = 'text' | 'field' | 'barcode' | 'line' | 'fold';
export const ELEMENT_TYPE_NAMES: Record<LabelElementType, string> = { text: '고정 문구', field: '항목', barcode: 'QR 코드', line: '구분선', fold: '접는선' };

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
}

export interface LabelTemplate {
  widthMm: number;
  heightMm: number; // 전체 높이 = 프린터 용지 높이. 접는선이 있으면 위쪽이 상단 면, 아래쪽이 측면이다
  elements: LabelElement[]; // 접는선(fold)도 여기 들어 있다
}

export interface Fold {
  yMm: number; // 접는 위치. 상단 면 높이와 같고, 측면 높이 = heightMm - yMm
  sideWidthMm: number; // 측면에 붙는 폭(옆면이 라벨보다 좁을 때). 측면 영역에서 가운데 이 폭 밖은 쓰지 않는다
}

export function foldOf(t: Pick<LabelTemplate, 'elements'>): Fold | null {
  const el = t.elements.find((e) => e.type === 'fold');
  return el ? { yMm: el.y, sideWidthMm: el.w } : null;
}

// 접는선 주변과 측면 폭 밖(좌우)은 쓸 수 없다. 항목이 쓸 수 없는 곳에 걸쳐 있는지 알려 준다. 접는선이 없는 라벨은 제한이 없다.
export function elementProblem(el: Pick<LabelElement, 'x' | 'y' | 'w' | 'h'>, t: LabelTemplate): 'fold' | 'side-width' | null {
  const fold = foldOf(t);
  if (!fold) return null;
  const foldTop = fold.yMm - FOLD_KEEP_OUT_MM;
  const foldBottom = fold.yMm + FOLD_KEEP_OUT_MM;
  if (el.y < foldBottom && el.y + el.h > foldTop) return 'fold';
  if (el.y + el.h > foldBottom - 0.01 && fold.sideWidthMm < t.widthMm) {
    const left = (t.widthMm - fold.sideWidthMm) / 2;
    if (el.x < left - 0.01 || el.x + el.w > left + fold.sideWidthMm + 0.01) return 'side-width';
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
  merge: string; // 합포장이면 "합포장 1·2", 아니면 빈 글자
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
    case 'merge': return data.merge;
  }
}

// 박스 번호는 전체 박스 수를 쓰지 않고 번호만 찍는다(박스가 늘어도 이미 붙인 라벨을 다시 붙이지 않게).
// 고객명과 박스 번호는 한 항목("고객명 #번호")이다 — 이름 길이에 따라 글자 크기를 자동으로 맞춘다(label-view의 FitText).
const WRAP_TEMPLATE: LabelTemplate = {
  widthMm: 100,
  heightMm: 80,
  elements: [
    // 상단 면 (y 0~60, 접는선 주변 58~62는 비워 둔다). QR은 오른쪽 위 모서리에 21mm로 크게 두고(사방 4mm는 비운다),
    // 고객명은 QR 아래에서 라벨 전체 폭을 쓴다.
    { id: 'w-terminal', type: 'field', field: 'terminal', x: 4, y: 3, w: 46, h: 14, fontSize: 34, bold: true, align: 'left' },
    { id: 'w-date', type: 'field', field: 'date', x: 4, y: 17.5, w: 46, h: 5.5, fontSize: 12, bold: false, align: 'left' },
    { id: 'w-qr-top', type: 'barcode', x: 74, y: 4, w: 21, h: 21 },
    { id: 'w-business', type: 'field', field: 'businessBox', x: 4, y: 30, w: 92, h: 14, fontSize: 32, bold: true, align: 'left' },
    { id: 'w-line', type: 'line', x: 4, y: 45.2, w: 92, h: 0.4 },
    { id: 'w-merge', type: 'field', field: 'merge', x: 4, y: 46.5, w: 46, h: 6, fontSize: 14, bold: true, align: 'left' },
    { id: 'w-separate', type: 'field', field: 'separate', x: 50, y: 46.5, w: 46, h: 6, fontSize: 14, bold: true, align: 'right' },
    { id: 'w-number', type: 'field', field: 'barcodeNumber', x: 4, y: 52.5, w: 32, h: 5, fontSize: 11, bold: true, align: 'left' },
    { id: 'w-company', type: 'field', field: 'company', x: 36, y: 52.5, w: 28, h: 5, fontSize: 10, bold: true, align: 'center' },
    { id: 'w-contact', type: 'field', field: 'contact', x: 64, y: 52.5, w: 32, h: 5, fontSize: 10, bold: false, align: 'right' },
    { id: 'w-fold', type: 'fold', x: 0, y: 60, w: 100, h: 0 },
    // 측면 (y 60~80, 접는선 주변 62까지 비움, 아래 가장자리는 프린터 출력 여백). 쌓은 박스는 옆면에서 스캔한다.
    { id: 'w-qr-side', type: 'barcode', x: 6, y: 63.5, w: 13.1, h: 13.1 },
    { id: 'w-terminal-side', type: 'field', field: 'terminal', x: 22, y: 63.5, w: 20, h: 8, fontSize: 20, bold: true, align: 'left' },
    { id: 'w-business-side', type: 'field', field: 'businessBox', x: 42, y: 63.5, w: 52, h: 8, fontSize: 20, bold: true, align: 'right' },
    { id: 'w-number-side', type: 'field', field: 'barcodeNumber', x: 22, y: 72, w: 40, h: 5, fontSize: 10, bold: true, align: 'left' },
    { id: 'w-date-side', type: 'field', field: 'date', x: 62, y: 72, w: 32, h: 5, fontSize: 10, bold: false, align: 'right' },
  ],
};

// 윗면에만 붙이는 평평한 라벨: 접는선이 없어 100×80 전체를 쓰고, 그만큼 글자와 QR을 크게 둔다.
const FLAT_TEMPLATE: LabelTemplate = {
  widthMm: 100,
  heightMm: 80,
  elements: [
    { id: 'f-terminal', type: 'field', field: 'terminal', x: 4, y: 3, w: 62, h: 16, fontSize: 38, bold: true, align: 'left' },
    { id: 'f-date', type: 'field', field: 'date', x: 4, y: 20, w: 30, h: 5.5, fontSize: 13, bold: false, align: 'left' },
    { id: 'f-separate', type: 'field', field: 'separate', x: 34, y: 20, w: 32, h: 5.5, fontSize: 13, bold: true, align: 'right' },
    { id: 'f-merge', type: 'field', field: 'merge', x: 4, y: 26.5, w: 62, h: 6.5, fontSize: 16, bold: true, align: 'left' },
    { id: 'f-qr', type: 'barcode', x: 71, y: 4.5, w: 23.6, h: 23.6 },
    { id: 'f-business', type: 'field', field: 'businessBox', x: 4, y: 34, w: 92, h: 16, fontSize: 36, bold: true, align: 'left' },
    { id: 'f-line', type: 'line', x: 4, y: 51.5, w: 92, h: 0.4 },
    { id: 'f-number', type: 'field', field: 'barcodeNumber', x: 4, y: 53, w: 92, h: 10, fontSize: 22, bold: true, align: 'left' },
    { id: 'f-company', type: 'field', field: 'company', x: 4, y: 65, w: 46, h: 8, fontSize: 15, bold: true, align: 'left' },
    { id: 'f-contact', type: 'field', field: 'contact', x: 50, y: 65, w: 46, h: 8, fontSize: 15, bold: false, align: 'right' },
  ],
};

// 새 디자인을 만들 때 고르는 시작 배치. 코드에 두는 이유: 디자인을 하나도 저장하지 않은 상태에서도 시작점이 있어야 한다.
export const LABEL_PRESETS = [
  { key: 'wrap', name: '감아 붙이기', description: '100×80mm · 윗면 60 + 옆면 20, 접는선 있음', template: WRAP_TEMPLATE },
  { key: 'flat', name: '윗면 전용', description: '100×80mm · 전체가 윗면, 접는선 없음', template: FLAT_TEMPLATE },
] as const;
export type LabelPresetKey = (typeof LABEL_PRESETS)[number]['key'];

// 저장된 디자인이 없을 때(또는 사용 중 디자인을 못 읽을 때) 출력에 쓰는 배치.
export const DEFAULT_TEMPLATE: LabelTemplate = WRAP_TEMPLATE;

const clampNum = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// DB(jsonb)에서 읽은 값을 안전한 항목 배열로 만든다. 알 수 없는 값은 버리거나 기본값으로 바꾼다. 접는선은 하나만 남긴다.
export function parseElements(value: unknown): LabelElement[] {
  if (!Array.isArray(value)) return [];
  const out: LabelElement[] = [];
  value.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) return;
    const r = raw as Record<string, unknown>;
    const type = r.type;
    if (type !== 'text' && type !== 'field' && type !== 'barcode' && type !== 'line' && type !== 'fold') return;
    if (type === 'fold' && out.some((e) => e.type === 'fold')) return;
    const field = typeof r.field === 'string' && r.field in LABEL_FIELDS ? (r.field as LabelField) : undefined;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `e-${index}`,
      type,
      field: type === 'field' ? field ?? 'businessBox' : undefined,
      text: type === 'text' ? String(r.text ?? '') : undefined,
      x: clampNum(r.x, 0, 0, 300),
      y: clampNum(r.y, 0, 0, 300),
      w: clampNum(r.w, 20, type === 'fold' ? 10 : 0.2, 300),
      h: type === 'fold' ? 0 : clampNum(r.h, 8, 0.2, 300),
      fontSize: type === 'text' || type === 'field' ? clampNum(r.fontSize, 12, 4, 120) : undefined,
      bold: type === 'text' || type === 'field' ? r.bold === true : undefined,
      align: r.align === 'center' || r.align === 'right' ? r.align : 'left',
    });
  });
  return out;
}

// 접는선을 라벨 크기에 맞춘다: 옆면 폭은 라벨 폭 이하, x는 가운데 기준, 위치는 위아래에 최소 높이가 남는 범위.
// 라벨 크기를 바꾸는 화면과 DB에서 읽을 때 같이 쓴다.
const MIN_FACE_MM = 8;
export function normalizeTemplate(t: LabelTemplate): LabelTemplate {
  return {
    ...t,
    elements: t.elements.map((el) => {
      if (el.type !== 'fold') return el;
      const w = Math.min(Math.max(el.w, 10), t.widthMm);
      const y = Math.min(Math.max(el.y, 10), Math.max(10, t.heightMm - MIN_FACE_MM));
      return { ...el, x: (t.widthMm - w) / 2, y, w, h: 0 };
    }),
  };
}

export function buildTemplate(row: { width_mm: number | string; height_mm: number | string; elements: unknown } | null | undefined): LabelTemplate {
  if (!row) return DEFAULT_TEMPLATE;
  return normalizeTemplate({
    widthMm: clampNum(row.width_mm, DEFAULT_TEMPLATE.widthMm, 20, 300),
    heightMm: clampNum(row.height_mm, DEFAULT_TEMPLATE.heightMm, 20, 300),
    elements: parseElements(row.elements),
  });
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
  merge: '합포장 1·2',
};
