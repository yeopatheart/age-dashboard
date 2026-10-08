'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateBusiness, findOrCreateDailyBusiness } from '@/lib/business-lookup';
import type { ChangeStatus } from '@/lib/orders';

export async function togglePacked(orderItemId: string, nextPacked: boolean) {
  const supabase = await createClient();
  await supabase
    .from('order_items')
    .update({ is_packed: nextPacked, packed_at: nextPacked ? new Date().toISOString() : null })
    .eq('id', orderItemId);
  revalidatePath('/dashboard');
}

export async function acknowledgeChange(orderItemId: string) {
  const supabase = await createClient();
  await supabase.from('order_items').update({ change_status: 'none' }).eq('id', orderItemId);
  revalidatePath('/dashboard');
}

// ── 매트릭스 대시보드의 수동 편집 액션 ──────────────────────────────────────────

export async function updateTotalBoxes(dailyBusinessId: string, totalBoxes: number) {
  const supabase = await createClient();
  await supabase.from('daily_businesses').update({ total_boxes: totalBoxes }).eq('id', dailyBusinessId);
  revalidatePath('/dashboard');
}

export async function createManualOrder(
  orderDate: string,
  businessName: string,
  terminalId: string | null,
  totalBoxes: number,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const businessId = await findOrCreateBusiness(supabase, businessName, terminalId);
  if (!businessId) return { error: '업체를 생성하지 못했습니다.' };

  const dailyBusinessId = await findOrCreateDailyBusiness(supabase, orderDate, businessId);
  if (!dailyBusinessId) return { error: '오늘자 주문 카드를 생성하지 못했습니다.' };

  await supabase.from('daily_businesses').update({ total_boxes: totalBoxes }).eq('id', dailyBusinessId);
  revalidatePath('/dashboard');
  return { error: null };
}

// 업체명·터미널은 daily_businesses가 아니라 businesses 테이블 소속이라, 바꾸면 다른 날짜의
// 과거 기록 표시에도 영향을 준다(호출하는 쪽 UI에서 이 점을 안내해야 한다).
export async function updateOrder(dailyBusinessId: string, businessName: string, terminalId: string | null) {
  const supabase = await createClient();
  const { data: daily } = await supabase
    .from('daily_businesses')
    .select('business_id')
    .eq('id', dailyBusinessId)
    .maybeSingle();
  if (!daily) return;
  await supabase
    .from('businesses')
    .update({ name: businessName, terminal_id: terminalId })
    .eq('id', daily.business_id);
  revalidatePath('/dashboard');
}

// order_items는 daily_businesses에 on delete cascade로 걸려있어(0003) 함께 삭제된다.
export async function deleteDailyBusiness(dailyBusinessId: string) {
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
}

export async function addOrderItemManual(dailyBusinessId: string, fields: ManualItemFields) {
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
    change_status: fields.changeStatus,
    created_by: userId,
  });
  revalidatePath('/dashboard');
}

export async function updateOrderItemManual(orderItemId: string, fields: ManualItemFields) {
  const supabase = await createClient();
  await supabase
    .from('order_items')
    .update({
      product_name_raw: fields.productName,
      quantity: fields.quantity,
      unit: fields.unit,
      secondary_weight_kg: fields.secondaryWeightKg,
      size_request: fields.sizeRequest,
      change_status: fields.changeStatus,
    })
    .eq('id', orderItemId);
  revalidatePath('/dashboard');
}

export async function cancelOrderItem(orderItemId: string) {
  const supabase = await createClient();
  await supabase.from('order_items').update({ change_status: 'cancelled' }).eq('id', orderItemId);
  revalidatePath('/dashboard');
}

export async function deleteOrderItem(orderItemId: string) {
  const supabase = await createClient();
  await supabase.from('order_items').delete().eq('id', orderItemId);
  revalidatePath('/dashboard');
}
