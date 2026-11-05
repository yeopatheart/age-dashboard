'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { normalizeRegistrationNo } from '@/lib/sellers';

export interface SellerInput {
  id?: string; // 있으면 수정, 없으면 등록
  name: string;
  representativeName: string;
  registrationNo: string;
  openedOn: string; // YYYY-MM-DD 또는 빈 글자
  address: string;
  businessType: string;
  businessItem: string;
  memo: string;
}

const clean = (value: string, max: number) => {
  const t = value.trim();
  return t === '' ? null : t.slice(0, max);
};

// 사업자 등록·수정. 길이와 형식은 DB 제약과 같은 기준으로 서버에서 한 번 더 확인한다.
export async function saveSeller(input: SellerInput): Promise<{ error: string | null }> {
  await requirePermission('sellers:edit');
  const name = input.name.trim();
  if (!name) return { error: '상호를 입력해주세요.' };
  if (name.length > 60) return { error: '상호는 60자 이하로 입력해주세요.' };
  const registrationNo = normalizeRegistrationNo(input.registrationNo);
  if (!registrationNo) return { error: '사업자등록번호는 숫자 10자리로 입력해주세요.' };
  const openedOn = input.openedOn.trim();
  if (openedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(openedOn) || Number.isNaN(Date.parse(openedOn)))) return { error: '개업일 형식이 올바르지 않습니다.' };

  const row = {
    name,
    registration_no: registrationNo,
    representative_name: clean(input.representativeName, 40),
    opened_on: openedOn || null,
    address: clean(input.address, 200),
    business_type: clean(input.businessType, 60),
    business_item: clean(input.businessItem, 60),
    memo: clean(input.memo, 500),
  };
  const supabase = await createClient();
  const { error } = input.id ? await supabase.from('seller_businesses').update(row).eq('id', input.id) : await supabase.from('seller_businesses').insert(row);
  if (error) return { error: error.code === '23505' ? '이미 등록된 사업자등록번호입니다.' : error.message };
  revalidatePath('/sellers');
  return { error: null };
}

export async function deleteSeller(id: string): Promise<{ error: string | null }> {
  await requirePermission('sellers:delete');
  const supabase = await createClient();
  const { error } = await supabase.from('seller_businesses').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/sellers');
  return { error: null };
}
