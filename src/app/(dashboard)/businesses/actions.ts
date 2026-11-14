'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';

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
  settlement?: BusinessSettlementFields, // 사업자명·사업자구분·퀵 이용(0063). 마이그레이션 전에는 보내지 않는다
): Promise<{ error: string | null }> {
  await requirePermission('businesses:edit');
  const parsed = normalizeInfo(info);
  if ('error' in parsed) return { error: parsed.error };
  const extra = settlement ? settlementColumns(settlement) : null;
  if (extra && 'error' in extra) return { error: extra.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from('businesses')
    .insert({ name: name.trim(), terminal_id: terminalId, notes, business_registration_no: parsed.regNo, representative_name: parsed.rep, ...extra });
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
  await requirePermission('businesses:edit');
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
  await requirePermission('businesses:delete');
  const supabase = await createClient();
  const { error } = await supabase.from('businesses').delete().eq('id', id);
  if (error) return { error: '이 업체의 과거 주문 기록이 있어 삭제할 수 없습니다.' };
  revalidatePath('/businesses');
  revalidatePath('/dashboard');
  return { error: null };
}

export interface BusinessSettlementFields {
  legalName: string | null; // 사업자명(실제 법인·회사명)
  sellerId: string | null; // 사업자구분: 이 업체에 공급자로 쓰는 우리 사업자(seller_businesses)
  usesQuick: boolean; // 퀵을 쓰는 고객사(퀵 가능 터미널이면 정산에 퀵을 제안한다)
}

function settlementColumns(fields: BusinessSettlementFields): { error: string } | { legal_name: string | null; seller_id: string | null; uses_quick: boolean } {
  const legalName = fields.legalName?.trim() || null;
  if (legalName !== null && legalName.length > 100) return { error: '사업자명은 100자 이하로 입력해주세요.' };
  return { legal_name: legalName, seller_id: fields.sellerId, uses_quick: fields.usesQuick === true };
}

// 고객사의 사업자명·사업자구분·퀵 이용 저장(0063). 사업자구분은 정산의 사업자 구분 기본값이 된다.
export async function setBusinessSettlementFields(id: string, fields: BusinessSettlementFields): Promise<{ error: string | null }> {
  await requirePermission('businesses:edit');
  const columns = settlementColumns(fields);
  if ('error' in columns) return { error: columns.error };
  const supabase = await createClient();
  const { error } = await supabase.from('businesses').update(columns).eq('id', id);
  if (error) {
    if (error.code === '23503') return { error: '선택한 사업자구분이 삭제되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
    return { error: error.message };
  }
  revalidatePath('/businesses');
  revalidatePath('/settlement');
  return { error: null };
}
