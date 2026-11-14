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
const isMoney = (v: number) => Number.isInteger(v) && v >= 0 && v <= MAX_PRICE;
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

// ─── 날짜별 품목 단가표 · 매입처 지급 ──────────────────────────────────────────

export interface PriceInput {
  product: string; // 품목(상품명) — 줄에 보이는 이름 그대로
  saleUnitPrice: number | null; // 판매 단가(원/kg)
  supplierId: string | null; // 기본 매입처
  purchaseUnitPrice: number | null; // 매입 단가(원/kg)
}

const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 품목 단가표 저장. 행은 (출고일 × 품목)이고 보낸 행의 값 전체로 바꾼다(세 칸이 모두 비면 그 행은 지운다 — 단가표를 따르던 줄은 비게 된다).
export async function savePrices(date: string, rows: PriceInput[]): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  if (!isRealDate(date)) return { error: '날짜가 올바르지 않습니다.' };
  if (rows.length === 0) return { error: null };
  if (rows.length > MAX_ROWS) return { error: `한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}건까지만 바꿀 수 있습니다.` };
  const byProduct = new Map<string, PriceInput>();
  for (const r of rows) {
    // 품목명은 화면이 보낸 그대로 쓴다(다듬으면 줄의 품목명과 단가표 키가 어긋난다).
    if (r.product.length < 1 || r.product.length > 100) return { error: '품목이 올바르지 않습니다.' };
    if ((r.saleUnitPrice !== null && !isMoney(r.saleUnitPrice)) || (r.purchaseUnitPrice !== null && !isMoney(r.purchaseUnitPrice))) return { error: '단가가 올바르지 않습니다.' };
    if (r.supplierId !== null && !UUID_PATTERN.test(r.supplierId)) return { error: '매입처가 올바르지 않습니다.' };
    byProduct.set(r.product, r);
  }
  const supabase = await createClient();
  const list = [...byProduct.values()];
  const empty = list.filter((r) => r.saleUnitPrice === null && r.supplierId === null && r.purchaseUnitPrice === null);
  const filled = list.filter((r) => !empty.includes(r));
  for (let i = 0; i < filled.length; i += CHUNK) {
    const chunk = filled.slice(i, i + CHUNK).map((r) => ({ order_date: date, product_name: r.product, sale_unit_price: r.saleUnitPrice, supplier_id: r.supplierId, purchase_unit_price: r.purchaseUnitPrice }));
    const { error } = await supabase.from('settlement_prices').upsert(chunk, { onConflict: 'order_date,product_name' });
    if (error) return { error: error.code === '23503' ? '매입처가 삭제되어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' : error.message };
  }
  // 세 칸을 모두 비운 품목의 행은 지운다(그 품목의 단가표 값만 지운다. 줄에서 직접 고친 값은 그대로다).
  for (let i = 0; i < empty.length; i += CHUNK) {
    const { error } = await supabase.from('settlement_prices').delete().eq('order_date', date).in('product_name', empty.slice(i, i + CHUNK).map((r) => r.product));
    if (error) return { error: error.message };
  }
  revalidatePath('/settlement');
  return { error: null };
}

// 가장 최근 단가표(이 날짜보다 앞선 날 중)에서 오늘 아직 없는 품목의 단가를 불러온다. 이미 있는 행은 건드리지 않는다.
export async function copyPreviousPrices(date: string, products: string[]): Promise<{ error: string | null; copied: number }> {
  await requirePermission('settlement:edit');
  if (!isRealDate(date)) return { error: '날짜가 올바르지 않습니다.', copied: 0 };
  const wanted = new Set(products.filter((p) => p.length >= 1 && p.length <= 100));
  if (wanted.size === 0) return { error: null, copied: 0 };
  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase.from('settlement_prices').select('order_date').lt('order_date', date).order('order_date', { ascending: false }).limit(1);
  if (latestError) return { error: latestError.message, copied: 0 };
  const from = latest?.[0]?.order_date;
  if (!from) return { error: '불러올 이전 단가표가 없습니다.', copied: 0 };
  const [{ data: previous, error: previousError }, { data: today, error: todayError }] = await Promise.all([
    supabase.from('settlement_prices').select('product_name, sale_unit_price, supplier_id, purchase_unit_price').eq('order_date', from),
    supabase.from('settlement_prices').select('product_name').eq('order_date', date),
  ]);
  if (previousError || todayError) return { error: (previousError ?? todayError)?.message ?? '조회하지 못했습니다.', copied: 0 };
  const have = new Set((today ?? []).map((r) => r.product_name));
  const rows = (previous ?? []).filter((r) => wanted.has(r.product_name) && !have.has(r.product_name)).map((r) => ({ order_date: date, product_name: r.product_name, sale_unit_price: r.sale_unit_price, supplier_id: r.supplier_id, purchase_unit_price: r.purchase_unit_price }));
  if (rows.length === 0) return { error: null, copied: 0 };
  const { error } = await supabase.from('settlement_prices').upsert(rows, { onConflict: 'order_date,product_name', ignoreDuplicates: true });
  if (error) return { error: error.message, copied: 0 };
  revalidatePath('/settlement');
  return { error: null, copied: rows.length };
}

// 매입처별 지급 체크(그날 그 매입처에 지급했는지). 여러 매입처를 한꺼번에 바꿀 수 있다.
export async function saveSupplierPaid(date: string, supplierIds: string[], paid: boolean): Promise<{ error: string | null }> {
  await requirePermission('settlement:edit');
  if (!isRealDate(date)) return { error: '날짜가 올바르지 않습니다.' };
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return { error: null };
  if (ids.length > MAX_ROWS || ids.some((id) => !UUID_PATTERN.test(id))) return { error: '매입처가 올바르지 않습니다.' };
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = ids.slice(i, i + CHUNK).map((supplier_id) => ({ order_date: date, supplier_id, paid: paid === true }));
    const { error } = await supabase.from('settlement_supplier_payments').upsert(rows, { onConflict: 'order_date,supplier_id' });
    if (error) return { error: error.code === '23503' ? '매입처가 삭제되어 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' : error.message };
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
