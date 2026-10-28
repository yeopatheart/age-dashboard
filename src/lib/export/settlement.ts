// 대시보드 "엑셀 다운로드": 별도 주문(택배) 고객의 정산용 표. 형이 정산·후속 작업에 쓰는 양식을 그대로 따른다.
// 열: 날짜 | 구분 | 고객명 | 품목 | 세부내역 | 매입처 | 매입가 | (공란) | 판매가
//  - 고객마다 상품 줄 + 마지막에 "택배 / N박스" 줄 하나.
//  - 구분·매입처·매입가·공란·판매가는 시스템에 없는 값이라 비워서 내려보내고 엑셀에서 채운다.
import { isUndecidedQuantity, type OrderItem, type OrderRow } from '@/lib/orders';

export const SETTLEMENT_HEADERS = ['날짜', '구분', '고객명', '품목', '세부내역', '매입처', '매입가', '공란', '판매가'] as const;

export interface SettlementLine {
  date: string; // YYYY-MM-DD
  division: string;
  customer: string;
  product: string;
  detail: string;
  supplier: string;
  cost: string;
  blank: string;
  price: string;
}

const formatNumber = (n: number) => String(Math.round(n * 100) / 100);

// "10미5.9키로"처럼 수량 + 단위, 무게가 있으면 뒤에 붙인다. 실측 중량(박스 할당)이 있으면 그것을, 없으면 주문에 적힌 중량을 쓴다.
// 단위가 kg인 상품은 수량이 이미 무게이므로 "5키로"로만 쓴다.
export function settlementDetail(item: Pick<OrderItem, 'quantity' | 'unit' | 'unshippedQuantity' | 'secondaryWeightKg' | 'measuredWeightKg'>): string {
  if (isUndecidedQuantity(item)) return '수량 미정';
  const shippable = Math.max(0, item.quantity - item.unshippedQuantity);
  const isKg = item.unit.toLowerCase() === 'kg';
  const base = `${formatNumber(shippable)}${isKg ? '키로' : item.unit}`;
  const weight = isKg ? null : item.measuredWeightKg ?? item.secondaryWeightKg ?? null;
  return weight != null ? `${base}${formatNumber(weight)}키로` : base;
}

export function buildSettlementLines(rows: OrderRow[], items: OrderItem[], orderDate: string): SettlementLine[] {
  const lines: SettlementLine[] = [];
  for (const row of rows) {
    const rowItems = items
      .filter((i) => i.dailyBusinessId === row.dailyBusinessId && i.changeStatus !== 'cancelled' && (isUndecidedQuantity(i) || i.quantity - i.unshippedQuantity > 0))
      .sort((a, b) => a.productSequence - b.productSequence);
    const base = { date: orderDate, division: '', customer: row.businessName, supplier: '', cost: '', blank: '', price: '' };
    for (const item of rowItems) lines.push({ ...base, product: item.productName, detail: settlementDetail(item) });
    lines.push({ ...base, product: '택배', detail: row.totalBoxes != null ? `${row.totalBoxes}박스` : '' });
  }
  return lines;
}

// 서식이 있는 .xlsx를 만든다(머리글 색·굵게, 필터, 첫 줄 고정, 날짜·원화 표시). exceljs는 크므로 내려받을 때만 불러온다.
export async function buildSettlementWorkbook(lines: SettlementLine[], orderDate: string): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`정산_${orderDate}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: SETTLEMENT_HEADERS[0], key: 'date', width: 11 },
    { header: SETTLEMENT_HEADERS[1], key: 'division', width: 14 },
    { header: SETTLEMENT_HEADERS[2], key: 'customer', width: 18 },
    { header: SETTLEMENT_HEADERS[3], key: 'product', width: 16 },
    { header: SETTLEMENT_HEADERS[4], key: 'detail', width: 18 },
    { header: SETTLEMENT_HEADERS[5], key: 'supplier', width: 14 },
    { header: SETTLEMENT_HEADERS[6], key: 'cost', width: 14 },
    { header: SETTLEMENT_HEADERS[7], key: 'blank', width: 18 },
    { header: SETTLEMENT_HEADERS[8], key: 'price', width: 14 },
  ];
  const date = new Date(`${orderDate}T00:00:00Z`);
  for (const l of lines) {
    sheet.addRow({ date, division: l.division, customer: l.customer, product: l.product, detail: l.detail, supplier: l.supplier, cost: l.cost || null, blank: l.blank, price: l.price || null });
  }

  const thin = { style: 'thin' as const, color: { argb: 'FFA6A6A6' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9DC3E6' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border;
  });
  sheet.getRow(1).height = 20;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border;
      cell.alignment = { vertical: 'middle' };
    });
    row.getCell('date').numFmt = 'yy-mm-dd';
    row.getCell('cost').numFmt = '"₩"#,##0';
    row.getCell('price').numFmt = '"₩"#,##0';
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SETTLEMENT_HEADERS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
