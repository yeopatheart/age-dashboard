'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { parseShippingMethod, shippingInputError, UUID_PATTERN, type ShippingInput } from '@/lib/settlement/shipping';
import { upsertSalesChanges, upsertShippingRows } from '@/lib/settlement/write';
import { salesFieldsError, type SalesLineFields } from '@/lib/settlement/sales-edit';

export interface SalesLineChange {
  itemId: string; // 판매내역 줄(주문 줄 id)
  fields: SalesLineFields; // 보낸 항목만 바꾼다
}

const MAX_ROWS = 5000;
const MAX_PRICE = 99_999_999_999; // src/lib/money.ts의 MAX_WON_DIGITS(11자리)와 같다
const CHUNK = 500;

// 정산표의 판매 줄 저장. 줄마다 값이 달라도 한 번에 보낸다(칸 하나 수정, 여러 칸 붙여넣기, 아래로 채우기가 모두 이 액션을 쓴다).
// 줄이 처음 입력되면 행을 만들고, 이미 있으면 보낸 항목만 바꾼다(보내지 않은 항목은 그대로).
export async function saveSalesLines(changes: SalesLineChange[]): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  if (changes.length === 0) return { error: null };
  if (changes.length > MAX_ROWS) return { error: `한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}건까지만 바꿀 수 있습니다.` };
  const merged = new Map<string, SalesLineFields>(); // 같은 줄이 겹치면 뒤의 값이 이긴다
  for (const c of changes) {
    if (!UUID_PATTERN.test(c.itemId)) return { error: '판매 줄이 올바르지 않습니다.' };
    const problem = salesFieldsError(c.fields);
    if (problem) return { error: problem };
    const f: SalesLineFields = { ...c.fields };
    if (typeof f.product === 'string') f.product = f.product.trim();
    if (typeof f.unit === 'string') f.unit = f.unit.trim();
    if (f.memo !== undefined) f.memo = f.memo.trim();
    merged.set(c.itemId, { ...merged.get(c.itemId), ...f });
  }
  const supabase = await createClient();
  const result = await upsertSalesChanges(supabase, [...merged].map(([itemId, fields]) => ({ itemId, label: '', fields, diffs: [] })));
  if (result.error) return result;
  revalidatePath('/settlement');
  return { error: null };
}

// 고객 카드 단위 값(사업자구분·입금) 저장(0064). 여러 카드에 같은 값을 한꺼번에 적용할 수 있다. 보낸 항목만 바꾼다.
export async function saveCardSettings(cardIds: string[], patch: { sellerId?: string | null; paid?: boolean }): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return { error: null };
  if (ids.length > MAX_ROWS || ids.some((id) => !UUID_PATTERN.test(id))) return { error: '고객 카드가 올바르지 않습니다.' };
  const fields: { seller_id?: string | null; paid?: boolean } = {};
  if (patch.sellerId !== undefined) {
    if (patch.sellerId !== null && !UUID_PATTERN.test(patch.sellerId)) return { error: '사업자 구분이 올바르지 않습니다.' };
    fields.seller_id = patch.sellerId;
  }
  if (patch.paid !== undefined) fields.paid = patch.paid === true;
  if (Object.keys(fields).length === 0) return { error: null };
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = ids.slice(i, i + CHUNK).map((daily_business_id) => ({ daily_business_id, ...fields }));
    const { error } = await supabase.from('settlement_cards').upsert(rows, { onConflict: 'daily_business_id' });
    if (error) {
      if (error.code === '23503') return { error: '주문 카드나 사업자가 바뀌어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
      return { error: error.message };
    }
  }
  revalidatePath('/settlement');
  revalidatePath('/dispatch'); // 보내기 화면도 사업자구분으로 영수증 대상을 묶는다
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
  const supabase = await createClient();
  const result = await upsertShippingRows(supabase, rows);
  if (result.error) return result;
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
