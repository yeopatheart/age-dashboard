'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateBusiness, findOrCreateDailyBusiness } from '@/lib/business-lookup';
import type { ChangeStatus, OrderRound, Prep } from '@/lib/orders';
import { requirePermission } from '@/lib/permissions/access';

export async function togglePacked(orderItemId: string, nextPacked: boolean) {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  await supabase
    .from('order_items')
    .update({ is_packed: nextPacked, packed_at: nextPacked ? new Date().toISOString() : null })
    .eq('id', orderItemId);
  revalidatePath('/dashboard');
}

// ── 매트릭스 대시보드의 수동 편집 액션 ──────────────────────────────────────────

export async function createManualOrder(
  orderDate: string,
  round: OrderRound,
  businessName: string,
  terminalId: string | null,
): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const businessId = await findOrCreateBusiness(supabase, businessName, terminalId);
  if (!businessId) return { error: '업체를 생성하지 못했습니다.' };

  const dailyBusinessId = await findOrCreateDailyBusiness(supabase, orderDate, businessId, round, terminalId);
  if (!dailyBusinessId) return { error: '오늘자 주문 카드를 생성하지 못했습니다.' };

  revalidatePath('/dashboard');
  return { error: null };
}

// 드래그로 바꾼 표시 순서를 저장한다. orderedIds는 그 날짜 카드 전체를 새 순서대로 담아야 한다.
export async function reorderDailyBusinesses(orderedIds: string[]): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_daily_businesses', { p_ids: orderedIds });
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  return { error: error?.message ?? null };
}

// 업체명은 businesses 테이블 소속이라 바꾸면 다른 날짜의 과거 기록 표시에도 영향을 준다.
// 터미널은 그날 카드(daily_businesses)의 값이라 이 주문만 바뀌고, 업체의 기본 터미널과 다른 날짜는 그대로다.
// 같은 날·차수·업체에 이미 그 터미널의 카드가 있으면 합칠 수 없어 오류를 돌려준다.
// 별도 주문 팝업에서 그날 카드의 고객명만 바꾼다(display_name). 고객사 이름(businesses.name)과 다른 날짜의 카드는 그대로다.
// 비우거나 고객사 이름과 같게 쓰면 기본 이름으로 돌아간다.
export async function renameDailyBusiness(dailyBusinessId: string, name: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const trimmed = name.trim();
  if (trimmed.length > 60) return { error: '고객명은 60자까지 입력할 수 있습니다.' };
  const supabase = await createClient();
  const { data: daily } = await supabase.from('daily_businesses').select('business_id').eq('id', dailyBusinessId).maybeSingle();
  if (!daily) return { error: '주문을 찾지 못했습니다.' };
  const { data: business } = await supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle();
  const displayName = trimmed && trimmed !== business?.name ? trimmed : null;
  const { error } = await supabase.from('daily_businesses').update({ display_name: displayName }).eq('id', dailyBusinessId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  revalidatePath('/scan');
  return { error: null };
}

export async function updateOrder(dailyBusinessId: string, businessName: string, terminalId: string | null): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: daily } = await supabase
    .from('daily_businesses')
    .select('business_id')
    .eq('id', dailyBusinessId)
    .maybeSingle();
  if (!daily) return { error: '주문을 찾지 못했습니다.' };
  const { error: terminalError } = await supabase.from('daily_businesses').update({ terminal_id: terminalId }).eq('id', dailyBusinessId);
  if (terminalError) {
    return { error: terminalError.code === '23505' ? '같은 차수에 이 터미널의 같은 업체 주문이 이미 있습니다.' : terminalError.message };
  }
  await supabase.from('businesses').update({ name: businessName }).eq('id', daily.business_id);
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  return { error: null };
}

// order_items는 daily_businesses에 on delete cascade로 걸려있어(0003) 함께 삭제된다.
export async function deleteDailyBusiness(dailyBusinessId: string) {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  await supabase.from('daily_businesses').delete().eq('id', dailyBusinessId);
  revalidatePath('/dashboard');
}

export interface ManualItemFields {
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  changeStatus: ChangeStatus;
  // 포장 방식: 일반 / 물봉 / 기포기(물봉 + 기포기 부착)
  prep: Prep;
}

export async function addOrderItemManual(dailyBusinessId: string, fields: ManualItemFields) {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? null;

  const { data: sequence } = await supabase.rpc('assign_product_sequence', {
    p_daily_business_id: dailyBusinessId,
  });

  await supabase.from('order_items').insert({
    daily_business_id: dailyBusinessId,
    product_sequence: sequence ?? 0,
    product_name_raw: fields.productName,
    quantity: fields.quantity,
    unit: fields.unit,
    secondary_weight_kg: fields.secondaryWeightKg,
    size_request: fields.sizeRequest,
    is_mulbong: fields.prep !== 'none',
    has_aerator: fields.prep === 'aerator',
    change_status: fields.changeStatus,
    created_by: userId,
  });
  revalidatePath('/dashboard');
}

export async function updateOrderItemManual(orderItemId: string, fields: ManualItemFields) {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  await supabase
    .from('order_items')
    .update({
      product_name_raw: fields.productName,
      quantity: fields.quantity,
      unit: fields.unit,
      secondary_weight_kg: fields.secondaryWeightKg,
      size_request: fields.sizeRequest,
      is_mulbong: fields.prep !== 'none',
      has_aerator: fields.prep === 'aerator',
      change_status: fields.changeStatus,
    })
    .eq('id', orderItemId);
  // 주문 수량을 미출고 수량보다 줄이면 미출고 수량도 주문 수량에 맞춘다.
  await supabase.from('order_items').update({ unshipped_quantity: fields.quantity }).eq('id', orderItemId).gt('unshipped_quantity', fields.quantity);
  revalidatePath('/dashboard');
}

// 미출고: 주문은 유효하지만 현장에서 출고하지 못한 수량과 사유를 기록한다(취소와 별개). 0이면 해제.
export async function setItemUnshipped(orderItemId: string, quantity: number, reason: string | null): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: item } = await supabase.from('order_items').select('quantity').eq('id', orderItemId).maybeSingle();
  if (!item) return { error: '상품을 찾지 못했습니다.' };
  const max = Number(item.quantity);
  if (!(quantity >= 0) || quantity > max + 0.0001) return { error: `미출고 수량은 0~${max} 사이여야 합니다.` };
  const { error } = await supabase
    .from('order_items')
    .update({ unshipped_quantity: quantity, unshipped_reason: quantity > 0 ? (reason?.trim() || null) : null })
    .eq('id', orderItemId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  return { error: null };
}

export async function cancelOrderItem(orderItemId: string) {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  await supabase.from('order_items').update({ change_status: 'cancelled' }).eq('id', orderItemId);
  revalidatePath('/dashboard');
}

export async function deleteOrderItem(orderItemId: string) {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  await supabase.from('order_items').delete().eq('id', orderItemId);
  revalidatePath('/dashboard');
}

// 대시보드 주문표에서 상품명을 강조할 상품을 날짜별로 켜고 끈다. 보기 설정이라 과거 날짜 편집 설정과 무관하게 항상 쓸 수 있다.
// 켤 때는 그날 이미 고른 개수 다음 순서를 준다(색은 이 순서로 다르게 나눠 준다).
export async function setProductHighlight(orderDate: string, productName: string, on: boolean): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  if (!on) {
    const { error } = await supabase.from('daily_product_highlights').delete().eq('order_date', orderDate).eq('product_name', productName);
    if (error) return { error: error.message };
  } else {
    const { data: last } = await supabase
      .from('daily_product_highlights')
      .select('position')
      .eq('order_date', orderDate)
      .order('position', { ascending: false })
      .limit(1);
    const { error } = await supabase
      .from('daily_product_highlights')
      .upsert({ order_date: orderDate, product_name: productName, position: (last?.[0]?.position ?? -1) + 1 }, { onConflict: 'order_date,product_name' });
    if (error) return { error: error.message };
  }
  revalidatePath('/dashboard');
  return { error: null };
}

export async function clearProductHighlights(orderDate: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('daily_product_highlights').delete().eq('order_date', orderDate);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}
