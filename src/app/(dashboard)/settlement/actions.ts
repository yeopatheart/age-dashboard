'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { parseShippingMethod, shippingInputError, UUID_PATTERN, type ShippingInput } from '@/lib/settlement/shipping';

export interface SalesPatch {
  itemIds: string[]; // 값을 바꿀 판매내역 줄(주문 줄 id). 여러 줄이면 같은 값을 일괄 적용한다
  sellerId?: string | null; // 사업자 구분(null = 미지정)
  price?: number | null; // 판매가(원, null = 비움)
  unitPrice?: number | null; // 단가(원, null = 비움). 영수증의 단가 칸에 쓴다
  product?: string | null; // 정산에서 고친 품목명(null = 주문 목록 값으로 되돌림)
  quantity?: number | null; // 고친 수량(null = 되돌림)
  unit?: string | null; // 고친 단위(null = 되돌림)
  paid?: boolean; // 입금 여부(Y = true)
  memo?: string | null;
}

const MAX_ROWS = 5000;
const MAX_PRODUCT_LEN = 60; // 0048의 check와 같다
const MAX_UNIT_LEN = 10;
const MAX_QUANTITY = 100_000;
const MAX_PRICE = 99_999_999_999; // src/lib/money.ts의 MAX_WON_DIGITS(11자리)와 같다
const CHUNK = 500;

// 판매내역 입력값 저장. 줄이 처음 입력되면 행을 만들고, 이미 있으면 보낸 항목만 바꾼다(보내지 않은 항목은 그대로).
export async function saveSales(patch: SalesPatch): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  const ids = [...new Set(patch.itemIds)];
  if (ids.length === 0) return { error: null };
  if (ids.length > MAX_ROWS) return { error: `한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}건까지만 바꿀 수 있습니다.` };

  const fields: { seller_id?: string | null; price?: number | null; unit_price?: number | null; product_override?: string | null; quantity_override?: number | null; unit_override?: string | null; paid?: boolean; memo?: string | null } = {};
  if (patch.sellerId !== undefined) fields.seller_id = patch.sellerId;
  if (patch.price !== undefined) {
    if (patch.price !== null && (!Number.isInteger(patch.price) || patch.price < 0 || patch.price > MAX_PRICE)) return { error: '판매가가 올바르지 않습니다.' };
    fields.price = patch.price;
  }
  if (patch.unitPrice !== undefined) {
    if (patch.unitPrice !== null && (!Number.isInteger(patch.unitPrice) || patch.unitPrice < 0 || patch.unitPrice > MAX_PRICE)) return { error: '단가가 올바르지 않습니다.' };
    fields.unit_price = patch.unitPrice;
  }
  if (patch.product !== undefined) {
    const product = patch.product === null ? null : patch.product.trim();
    if (product !== null && (product.length === 0 || product.length > MAX_PRODUCT_LEN)) return { error: `품목명은 1~${MAX_PRODUCT_LEN}자로 입력해주세요.` };
    fields.product_override = product;
  }
  if (patch.quantity !== undefined) {
    const q = patch.quantity;
    if (q !== null && (!Number.isFinite(q) || q <= 0 || q > MAX_QUANTITY || Math.round(q * 100) / 100 !== q)) return { error: `수량은 0보다 크고 ${MAX_QUANTITY.toLocaleString('ko-KR')} 이하(소수 둘째 자리까지)로 입력해주세요.` };
    fields.quantity_override = q;
  }
  if (patch.unit !== undefined) {
    const unit = patch.unit === null ? null : patch.unit.trim();
    if (unit !== null && (unit.length === 0 || unit.length > MAX_UNIT_LEN)) return { error: `단위는 1~${MAX_UNIT_LEN}자로 입력해주세요.` };
    fields.unit_override = unit;
  }
  if (patch.paid !== undefined) fields.paid = patch.paid === true;
  if (patch.memo !== undefined) {
    const memo = patch.memo === null ? '' : patch.memo.trim();
    if (memo.length > 500) return { error: '메모는 500자 이하로 입력해주세요.' };
    fields.memo = memo === '' ? null : memo;
  }
  if (Object.keys(fields).length === 0) return { error: null };

  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = ids.slice(i, i + CHUNK).map((order_item_id) => ({ order_item_id, ...fields }));
    const { error } = await supabase.from('settlement_sales').upsert(rows, { onConflict: 'order_item_id' });
    if (error) {
      if (error.code === '23503') return { error: '주문이 바뀌었거나 사업자가 삭제되어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
      return { error: error.message };
    }
  }
  revalidatePath('/settlement');
  return { error: null };
}

// ─── 매입내역 ────────────────────────────────────────────────────────────────

export interface PurchaseTarget {
  orderDate: string; // 출고일 YYYY-MM-DD
  productName: string; // 품목(상품명)
}

export interface PurchasePatch {
  targets: PurchaseTarget[]; // 값을 바꿀 매입내역 행. 여러 행이면 같은 값을 일괄 적용한다
  sellerId?: string | null; // 사업자 구분(null = 미지정)
  supplierId?: string | null; // 매입처(null = 비움)
  price?: number | null; // 매입가(원, null = 비움)
  paid?: boolean; // 입금 여부(Y = true)
  memo?: string | null;
}

const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 매입내역 입력값 저장. 행(출고일 × 품목)이 처음 입력되면 만들고, 이미 있으면 보낸 항목만 바꾼다(보내지 않은 항목은 그대로).
export async function savePurchases(patch: PurchasePatch): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  const seen = new Set<string>();
  const targets: PurchaseTarget[] = [];
  for (const t of patch.targets) {
    // 품목명은 화면이 보낸 그대로 쓴다(다듬으면 화면의 행 키와 저장 키가 어긋난다).
    const productName = t.productName;
    if (!isRealDate(t.orderDate) || productName.length < 1 || productName.length > 100) return { error: '출고일 또는 품목이 올바르지 않습니다.' };
    const key = `${t.orderDate}|${productName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ orderDate: t.orderDate, productName });
  }
  if (targets.length === 0) return { error: null };
  if (targets.length > MAX_ROWS) return { error: `한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}건까지만 바꿀 수 있습니다.` };

  const fields: { seller_id?: string | null; supplier_id?: string | null; price?: number | null; paid?: boolean; memo?: string | null } = {};
  if (patch.sellerId !== undefined) fields.seller_id = patch.sellerId;
  if (patch.supplierId !== undefined) fields.supplier_id = patch.supplierId;
  if (patch.price !== undefined) {
    if (patch.price !== null && (!Number.isInteger(patch.price) || patch.price < 0 || patch.price > MAX_PRICE)) return { error: '매입가가 올바르지 않습니다.' };
    fields.price = patch.price;
  }
  if (patch.paid !== undefined) fields.paid = patch.paid === true;
  if (patch.memo !== undefined) {
    const memo = patch.memo === null ? '' : patch.memo.trim();
    if (memo.length > 500) return { error: '메모는 500자 이하로 입력해주세요.' };
    fields.memo = memo === '' ? null : memo;
  }
  if (Object.keys(fields).length === 0) return { error: null };

  const supabase = await createClient();
  for (let i = 0; i < targets.length; i += CHUNK) {
    const rows = targets.slice(i, i + CHUNK).map((t) => ({ order_date: t.orderDate, product_name: t.productName, ...fields }));
    const { error } = await supabase.from('settlement_purchases').upsert(rows, { onConflict: 'order_date,product_name' });
    if (error) {
      if (error.code === '23503') return { error: '사업자 또는 매입처가 삭제되어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
      return { error: error.message };
    }
  }
  revalidatePath('/settlement');
  return { error: null };
}

// ─── 배송비(버스·퀵·택배) ────────────────────────────────────────────────────

// 배송비 저장. 행은 (카드 × 수단)이고 처음 저장하면 만들고 이미 있으면 보낸 값으로 바꾼다. 제안 줄도 이 액션으로 저장한다.
export async function saveShippingRows(rows: ShippingInput[]): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  if (rows.length === 0) return { error: null };
  if (rows.length > MAX_ROWS) return { error: `한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}건까지만 바꿀 수 있습니다.` };
  for (const r of rows) {
    const problem = shippingInputError(r);
    if (problem) return { error: problem };
  }
  const byKey = new Map(rows.map((r) => [`${r.cardId}|${r.method}`, r])); // 같은 행이 겹치면 마지막 값
  const supabase = await createClient();
  const list = [...byKey.values()];
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK).map((r) => {
      const memo = (r.memo ?? '').trim();
      return { daily_business_id: r.cardId, method: parseShippingMethod(r.method)!, boxes: r.boxes, amount: r.amount, seller_id: r.sellerId, paid: r.paid === true, memo: memo === '' ? null : memo };
    });
    const { error } = await supabase.from('settlement_shipping').upsert(chunk, { onConflict: 'daily_business_id,method' });
    if (error) {
      if (error.code === '23503') return { error: '주문 카드나 사업자가 바뀌어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
      return { error: error.message };
    }
  }
  revalidatePath('/settlement');
  return { error: null };
}

// 저장한 배송비 한 줄을 지운다(설정으로 만든 제안 줄은 다시 나타난다). 잘못 추가한 줄을 정리할 때 쓴다.
export async function deleteShippingRow(cardId: string, method: string): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  if (!UUID_PATTERN.test(cardId) || !parseShippingMethod(method)) return { error: '배송비 행이 올바르지 않습니다.' };
  const supabase = await createClient();
  const { error } = await supabase.from('settlement_shipping').delete().eq('daily_business_id', cardId).eq('method', parseShippingMethod(method)!);
  if (error) return { error: error.message };
  revalidatePath('/settlement');
  return { error: null };
}
