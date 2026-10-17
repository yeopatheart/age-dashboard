'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface BusinessInfo {
  businessRegistrationNo: string;
  representativeName: string;
}

// 사업자등록번호는 숫자 10자리만 받아서 000-00-00000 형식으로 저장한다(비워 두면 null).
function normalizeInfo(info: BusinessInfo): { error: string } | { regNo: string | null; rep: string | null } {
  const digits = info.businessRegistrationNo.replace(/\D/g, '');
  if (digits && digits.length !== 10) return { error: '사업자등록번호는 숫자 10자리입니다.' };
  return {
    regNo: digits ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : null,
    rep: info.representativeName.trim() || null,
  };
}

export async function createBusiness(
  name: string,
  terminalId: string | null,
  notes: string | null,
  info: BusinessInfo,
): Promise<{ error: string | null }> {
  const parsed = normalizeInfo(info);
  if ('error' in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from('businesses')
    .insert({ name: name.trim(), terminal_id: terminalId, notes, business_registration_no: parsed.regNo, representative_name: parsed.rep });
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
  info: BusinessInfo,
): Promise<{ error: string | null }> {
  const parsed = normalizeInfo(info);
  if ('error' in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from('businesses')
    .update({ name: name.trim(), terminal_id: terminalId, notes, business_registration_no: parsed.regNo, representative_name: parsed.rep })
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
