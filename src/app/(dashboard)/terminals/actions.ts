'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function createTerminal(name: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').insert({ name: name.trim() });
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}

export async function updateTerminal(id: string, name: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update({ name: name.trim() }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}

// businesses.terminal_id가 이 터미널을 참조 중이면 FK 제약으로 실패한다 — 의도된 보호이므로
// 에러 메시지를 그대로 사용자에게 보여준다.
export async function deleteTerminal(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').delete().eq('id', id);
  if (error) return { error: '이 터미널을 사용 중인 업체가 있어 삭제할 수 없습니다.' };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}
