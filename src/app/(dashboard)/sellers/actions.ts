'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { normalizeRegistrationNo } from '@/lib/sellers';
import { isValidSealDataUrl } from '@/lib/seal-image';

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

// 직인(도장) 등록·삭제. 영수증의 "(인)" 자리에 찍힌다. 사업자 등록 저장과는 따로 즉시 저장한다.
// 값은 작게 줄인 PNG data URL만 받는다(<img>에 그대로 쓰므로 서버에서 형식·크기를 한 번 더 확인한다). dataUrl이 null이면 삭제.
export async function saveSellerSeal(id: string, dataUrl: string | null): Promise<{ error: string | null }> {
  await requirePermission('sellers:edit');
  if (dataUrl !== null && !isValidSealDataUrl(dataUrl)) return { error: '직인 이미지 형식이 올바르지 않거나 용량이 너무 큽니다. 다시 올려주세요.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('seller_businesses').update({ seal_image: dataUrl }).eq('id', id).select('id');
  if (error) return { error: /seal_image/.test(error.message) ? '마이그레이션 0047_settlement_receipts.sql을 먼저 적용해주세요.' : error.message };
  if (!data || data.length === 0) return { error: '사업자를 찾지 못했습니다.' };
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
