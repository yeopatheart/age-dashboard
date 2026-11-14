// 정산 입력값 쓰기(서버 전용). 줄마다 값이 다른 일괄 쓰기를 위해 같은 열 묶음끼리 모아 upsert한다 —
// 열이 다른 행을 한꺼번에 upsert하면 빠진 열이 null로 덮어써지므로, 바뀐 열이 같은 행끼리만 묶어서 보낸다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { parseShippingMethod, type ShippingInput } from './shipping';
import type { PurchaseChange, SalesChange } from './excel-import';

type Client = SupabaseClient<Database>;
const CHUNK = 500;

type Result = { error: string | null };

// 열 묶음(정렬한 열 이름)이 같은 행끼리 모은다.
function groupByColumns<T extends { cols: Record<string, unknown> }>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = Object.keys(item.cols).sort().join(',');
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

const FK_MESSAGE = '주문이나 사업자·매입처가 바뀌어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';

export async function upsertSalesChanges(supabase: Client, changes: SalesChange[]): Promise<Result> {
  const items = changes.map((c) => {
    const cols: Record<string, unknown> = {};
    const f = c.fields;
    if (f.sellerId !== undefined) cols.seller_id = f.sellerId;
    if (f.price !== undefined) cols.price = f.price;
    if (f.unitPrice !== undefined) cols.unit_price = f.unitPrice;
    if (f.product !== undefined) cols.product_override = f.product;
    if (f.quantity !== undefined) cols.quantity_override = f.quantity;
    if (f.unit !== undefined) cols.unit_override = f.unit;
    if (f.paid !== undefined) cols.paid = f.paid;
    if (f.memo !== undefined) cols.memo = f.memo === '' ? null : f.memo;
    return { id: c.itemId, cols };
  });
  for (const group of groupByColumns(items)) {
    for (let i = 0; i < group.length; i += CHUNK) {
      const rows = group.slice(i, i + CHUNK).map((g) => ({ order_item_id: g.id, ...g.cols }));
      const { error } = await supabase.from('settlement_sales').upsert(rows, { onConflict: 'order_item_id' });
      if (error) return { error: error.code === '23503' ? FK_MESSAGE : error.message };
    }
  }
  return { error: null };
}

export async function upsertPurchaseChanges(supabase: Client, changes: PurchaseChange[]): Promise<Result> {
  const items = changes.map((c) => {
    const cols: Record<string, unknown> = {};
    const f = c.fields;
    if (f.supplierId !== undefined) cols.supplier_id = f.supplierId;
    if (f.price !== undefined) cols.price = f.price;
    if (f.sellerId !== undefined) cols.seller_id = f.sellerId;
    if (f.paid !== undefined) cols.paid = f.paid;
    if (f.memo !== undefined) cols.memo = f.memo === '' ? null : f.memo;
    return { id: `${c.orderDate}|${c.productName}`, orderDate: c.orderDate, productName: c.productName, cols };
  });
  for (const group of groupByColumns(items)) {
    for (let i = 0; i < group.length; i += CHUNK) {
      const rows = group.slice(i, i + CHUNK).map((g) => ({ order_date: g.orderDate, product_name: g.productName, ...g.cols }));
      const { error } = await supabase.from('settlement_purchases').upsert(rows, { onConflict: 'order_date,product_name' });
      if (error) return { error: error.code === '23503' ? FK_MESSAGE : error.message };
    }
  }
  return { error: null };
}

// 배송비는 행 전체 값(박스·금액·사업자·입금·메모)을 보내므로 열 묶음을 나눌 필요가 없다. 같은 (카드, 수단)이 겹치면 마지막 값.
export async function upsertShippingRows(supabase: Client, rows: ShippingInput[]): Promise<Result> {
  const byKey = new Map(rows.map((r) => [`${r.cardId}|${r.method}`, r]));
  const list = [...byKey.values()];
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK).map((r) => {
      const memo = (r.memo ?? '').trim();
      return { daily_business_id: r.cardId, method: parseShippingMethod(r.method)!, boxes: r.boxes, amount: r.amount, seller_id: r.sellerId, paid: r.paid === true, memo: memo === '' ? null : memo };
    });
    const { error } = await supabase.from('settlement_shipping').upsert(chunk, { onConflict: 'daily_business_id,method' });
    if (error) return { error: error.code === '23503' ? FK_MESSAGE : error.message };
  }
  return { error: null };
}
