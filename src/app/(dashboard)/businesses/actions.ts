'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function createBusiness(
  name: string,
  terminalId: string | null,
  notes: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('businesses').insert({ name: name.trim(), terminal_id: terminalId, notes });
  if (error) return { error: error.message };
  revalidatePath('/businesses');
  revalidatePath('/dashboard');
  return { error: null };
}

export async function updateBusiness(
  id: string,
  name: string,
  terminalId: string | null,
  notes: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('businesses')
    .update({ name: name.trim(), terminal_id: terminalId, notes })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/businesses');
  revalidatePath('/dashboard');
  return { error: null };
}

// daily_businesses.business_id가 이 업체를 참조 중이면(과거 주문 이력) FK 제약으로 실패한다 —
// 의도된 보호이므로 에러 메시지를 그대로 사용자에게 보여준다.
export async function deleteBusiness(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('businesses').delete().eq('id', id);
  if (error) return { error: '이 업체의 과거 주문 기록이 있어 삭제할 수 없습니다.' };
  revalidatePath('/businesses');
  revalidatePath('/dashboard');
  return { error: null };
}
