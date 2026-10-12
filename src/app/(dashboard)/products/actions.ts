'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { colorComboKey, isHueKey, pickUnusedColor } from '@/lib/color-palette';

function revalidate() {
  revalidatePath('/products');
  revalidatePath('/dashboard');
}

// 수기 등록. 색을 고르지 않으면 기존 상품이 쓰지 않는 조합을 자동으로 배정한다.
export async function createProduct(name: string, fill: string | null, border: string | null): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const trimmed = name.trim();
  if (!trimmed) return { error: '상품명을 입력해주세요.' };

  let colors = { fill_color: isHueKey(fill) ? fill : null, border_color: isHueKey(border) ? border : null };
  if (!colors.fill_color && !colors.border_color) {
    const { data: existing } = await supabase.from('products').select('fill_color, border_color');
    const used = new Set((existing ?? []).map((p) => colorComboKey(p.fill_color, p.border_color)));
    colors = pickUnusedColor(used);
  }

  const { error } = await supabase.from('products').insert({ name: trimmed, created_via: 'manual', ...colors });
  if (error) return { error: error.code === '23505' ? '이미 등록된 상품입니다.' : error.message };
  revalidate();
  return { error: null };
}

// 한 개 또는 여러 개에 같은 색을 적용한다(일괄 적용). 둘 다 null이면 기본 모양으로 되돌린다.
export async function setProductColors(ids: string[], fill: string | null, border: string | null): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase
    .from('products')
    .update({ fill_color: isHueKey(fill) ? fill : null, border_color: isHueKey(border) ? border : null })
    .in('id', ids);
  if (error) return { error: error.message };
  revalidate();
  return { error: null };
}

// 색이 없는 상품들에 기존 조합과 겹치지 않는 색을 하나씩 배정한다.
export async function autoAssignProductColors(): Promise<{ error: string | null; assigned: number }> {
  const supabase = await createClient();
  const { data } = await supabase.from('products').select('id, fill_color, border_color').order('name');
  const all = data ?? [];
  const used = new Set(all.filter((p) => p.fill_color || p.border_color).map((p) => colorComboKey(p.fill_color, p.border_color)));
  const targets = all.filter((p) => !p.fill_color && !p.border_color);

  const updates = targets.map((p) => {
    const color = pickUnusedColor(used);
    used.add(colorComboKey(color.fill_color, color.border_color));
    return supabase.from('products').update(color).eq('id', p.id);
  });
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message, assigned: 0 };
  revalidate();
  return { error: null, assigned: targets.length };
}

// 상품을 지워도 이미 들어온 주문은 이름 문자열을 갖고 있어 그대로 남는다(색만 기본 모양으로 돌아간다).
export async function deleteProducts(ids: string[]): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase.from('products').delete().in('id', ids);
  if (error) return { error: error.message };
  revalidate();
  return { error: null };
}

// 물봉(산소) 포장이 필요한 상품 표시. 한 개 또는 여러 개에 한 번에 적용한다.
export async function setProductMulbong(ids: string[], needsMulbong: boolean): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase.from('products').update({ needs_mulbong: needsMulbong }).in('id', ids);
  if (error) return { error: error.message };
  revalidate();
  return { error: null };
}
