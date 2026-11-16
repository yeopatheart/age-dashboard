'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { nonNegativeNumberError, textError } from '@/lib/validate';

export interface BoxFields {
  name: string;
  innerWidthCm: number | null;
  innerDepthCm: number | null;
  innerHeightCm: number | null;
  isMulbongBox: boolean;
  isActive: boolean;
  notes: string | null;
}

// 화면을 거치지 않고 직접 호출해도 공백 이름·음수 치수가 DB에 들어가지 않도록 서버에서 한 번 더 검사한다.
function boxFieldsError(fields: BoxFields): string | null {
  const dimension = (value: number | null, label: string) => (value === null ? null : nonNegativeNumberError(value, label, 1000));
  return (
    textError(fields.name, '박스 이름', 40) ??
    dimension(fields.innerWidthCm, '가로') ??
    dimension(fields.innerDepthCm, '세로') ??
    dimension(fields.innerHeightCm, '높이') ??
    (fields.notes !== null && fields.notes.length > 200 ? '메모는 200자까지 입력할 수 있습니다.' : null)
  );
}

export async function createBox(fields: BoxFields): Promise<{ error: string | null }> {
  await requirePermission('boxes:edit');
  const invalid = boxFieldsError(fields);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase.from('boxes').insert({
    name: fields.name.trim(),
    inner_width_cm: fields.innerWidthCm,
    inner_depth_cm: fields.innerDepthCm,
    inner_height_cm: fields.innerHeightCm,
    is_mulbong_box: fields.isMulbongBox,
    is_active: fields.isActive,
    notes: fields.notes,
  });
  if (error) return { error: error.message };
  revalidatePath('/boxes');
  return { error: null };
}

export async function updateBox(id: string, fields: BoxFields): Promise<{ error: string | null }> {
  await requirePermission('boxes:edit');
  const invalid = boxFieldsError(fields);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase
    .from('boxes')
    .update({
      name: fields.name.trim(),
      inner_width_cm: fields.innerWidthCm,
      inner_depth_cm: fields.innerDepthCm,
      inner_height_cm: fields.innerHeightCm,
      is_mulbong_box: fields.isMulbongBox,
      is_active: fields.isActive,
      notes: fields.notes,
    })
    .eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/boxes');
  return { error: null };
}

export async function setBoxActive(id: string, isActive: boolean): Promise<{ error: string | null }> {
  await requirePermission('boxes:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('boxes').update({ is_active: isActive }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/boxes');
  return { error: null };
}

export async function deleteBox(id: string): Promise<{ error: string | null }> {
  await requirePermission('boxes:delete');
  const supabase = await createClient();
  const { error } = await supabase.from('boxes').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/boxes');
  return { error: null };
}
