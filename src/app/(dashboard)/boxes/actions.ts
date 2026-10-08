'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface BoxFields {
  name: string;
  innerWidthCm: number | null;
  innerDepthCm: number | null;
  innerHeightCm: number | null;
  isMulbongBox: boolean;
  isActive: boolean;
  notes: string | null;
}

export async function createBox(fields: BoxFields): Promise<{ error: string | null }> {
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
  const supabase = await createClient();
  const { error } = await supabase.from('boxes').update({ is_active: isActive }).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/boxes');
  return { error: null };
}

export async function deleteBox(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from('boxes').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/boxes');
  return { error: null };
}
