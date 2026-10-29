'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';

export async function createTerminal(name: string): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').insert({ name: name.trim() });
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}

export async function updateTerminal(id: string, name: string): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update({ name: name.trim() }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}

// businesses.terminal_id(고객사 기본 터미널)나 daily_businesses.terminal_id(날짜별 주문)가 이 터미널을 참조 중이면 FK 제약으로 실패한다 — 의도된 보호이므로
// 에러 메시지를 그대로 사용자에게 보여준다.
export async function deleteTerminal(id: string): Promise<{ error: string | null }> {
  await requirePermission('terminals:delete');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').delete().eq('id', id);
  if (error) return { error: '이 터미널을 사용 중인 업체나 주문 이력이 있어 삭제할 수 없습니다.' };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}

// 색상은 palette key(src/lib/color-palette.ts)로만 저장한다. 둘 다 null이면 자동(이름 해시) 색으로 돌아간다.
export async function setTerminalColor(id: string, fill: string | null, border: string | null): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update({ fill_color: fill, border_color: border }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  revalidatePath('/businesses');
  return { error: null };
}

// 별도 주문 터미널(택배, 직배송 등)은 대시보드 기본 주문표에서 빠지고 "별도 주문" 보기에서만 보인다.
export async function setTerminalSeparate(id: string, isSeparate: boolean): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update(isSeparate ? { is_separate: true } : { is_separate: false, is_parcel: false }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}

// 택배 터미널은 택배사 송장을 붙이므로 박스 라벨을 출력하지 않는다. 택배는 별도 주문의 한 종류라 켜면 별도 주문도 함께 켠다.
export async function setTerminalParcel(id: string, isParcel: boolean): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update(isParcel ? { is_parcel: true, is_separate: true } : { is_parcel: false }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/dashboard');
  return { error: null };
}
