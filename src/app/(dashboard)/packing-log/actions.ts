'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function setItemWeight(orderItemId: string, weightKg: number | null): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('order_items').update({ measured_weight_kg: weightKg }).eq('id', orderItemId);
  if (error) return { error: error.message };
  revalidatePath('/packing-log');
  return { error: null };
}

// (업체, 박스 종류)당 한 행 — 같은 박스를 다시 고르면 개수만 덮어쓴다.
export async function setBoxUsage(
  dailyBusinessId: string,
  boxId: string,
  quantity: number,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('daily_business_boxes')
    .upsert({ daily_business_id: dailyBusinessId, box_id: boxId, quantity }, { onConflict: 'daily_business_id,box_id' });
  if (error) return { error: error.message };
  revalidatePath('/packing-log');
  return { error: null };
}

export async function removeBoxUsage(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('daily_business_boxes').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/packing-log');
  return { error: null };
}
