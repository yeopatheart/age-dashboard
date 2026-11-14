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

// 퀵이 안 되는 터미널은 끈다. 꺼진 터미널의 고객 카드에는 정산 배송비로 퀵을 제안하지 않는다(이미 저장한 값은 그대로 둔다).
export async function setTerminalQuickAllowed(id: string, allowed: boolean): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update({ quick_allowed: allowed }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/settlement');
  return { error: null };
}

export interface TerminalShippingRates {
  bus: number | null; // 박스당 기본 금액(원). null = 이 수단은 정산에 제안하지 않는다
  quick: number | null;
  parcel: number | null;
}

const MAX_RATE = 10_000_000; // 박스당 천만 원. 열은 integer라 넘치지 않게만 막는다

// 정산 배송비 제안에 쓰는 터미널별 수단별 박스당 기본 금액. 날짜별 금액은 정산에서 고친다.
export async function setTerminalShippingRates(id: string, rates: TerminalShippingRates): Promise<{ error: string | null }> {
  await requirePermission('terminals:edit');
  for (const v of [rates.bus, rates.quick, rates.parcel]) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > MAX_RATE)) return { error: `박스당 금액은 0~${MAX_RATE.toLocaleString('ko-KR')}원 사이 정수로 입력해주세요.` };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('terminals').update({ bus_rate: rates.bus, quick_rate: rates.quick, parcel_rate: rates.parcel }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/terminals');
  revalidatePath('/settlement');
  return { error: null };
}
