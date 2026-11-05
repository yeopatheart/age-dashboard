'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';

export interface SalesPatch {
  itemIds: string[]; // 값을 바꿀 판매내역 줄(주문 줄 id). 여러 줄이면 같은 값을 일괄 적용한다
  sellerId?: string | null; // 사업자 구분(null = 미지정)
  price?: number | null; // 판매가(원, null = 비움)
  paid?: boolean; // 입금 여부(Y = true)
  memo?: string | null;
}

const MAX_ROWS = 5000;
const MAX_PRICE = 99_999_999_999; // src/lib/money.ts의 MAX_WON_DIGITS(11자리)와 같다
const CHUNK = 500;

// 판매내역 입력값 저장. 줄이 처음 입력되면 행을 만들고, 이미 있으면 보낸 항목만 바꾼다(보내지 않은 항목은 그대로).
export async function saveSales(patch: SalesPatch): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  const ids = [...new Set(patch.itemIds)];
  if (ids.length === 0) return { error: null };
  if (ids.length > MAX_ROWS) return { error: `한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}건까지만 바꿀 수 있습니다.` };

  const fields: { seller_id?: string | null; price?: number | null; paid?: boolean; memo?: string | null } = {};
  if (patch.sellerId !== undefined) fields.seller_id = patch.sellerId;
  if (patch.price !== undefined) {
    if (patch.price !== null && (!Number.isInteger(patch.price) || patch.price < 0 || patch.price > MAX_PRICE)) return { error: '판매가가 올바르지 않습니다.' };
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
