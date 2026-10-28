'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { colorComboKey, isHueKey, pickUnusedColor } from '@/lib/color-palette';
import { requirePermission } from '@/lib/permissions/access';

function revalidate() {
  revalidatePath('/products');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
  revalidatePath('/packing-log');
}

// 수기 등록. 색을 고르지 않으면 기존 상품이 쓰지 않는 조합을 자동으로 배정한다.
export async function createProduct(name: string, fill: string | null, border: string | null): Promise<{ error: string | null }> {
  await requirePermission('products:edit');
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
  await requirePermission('products:edit');
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
  await requirePermission('products:edit');
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
  await requirePermission('products:delete');
  if (ids.length === 0) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase.from('products').delete().in('id', ids);
  if (error) return { error: error.message };
  revalidate();
  return { error: null };
}

// 물봉(산소) 포장이 필요한 상품 표시. 한 개 또는 여러 개에 한 번에 적용한다.
export async function setProductMulbong(ids: string[], needsMulbong: boolean): Promise<{ error: string | null }> {
  await requirePermission('products:edit');
  if (ids.length === 0) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase.from('products').update({ needs_mulbong: needsMulbong }).in('id', ids);
  if (error) return { error: error.message };
  revalidate();
  return { error: null };
}

// 상품명 수정. 주문은 상품 이름 문자열로 저장돼 있어서(상품 색·품목별 수량·리포트가 모두 이름으로 연결된다) 과거
// 주문의 상품명도 함께 바꿔야 연결이 끊기지 않는다. 박스 기록은 "그 당시 값" 스냅샷이라 건드리지 않는다.
// 이미 있는 이름으로 바꾸려고 하면 막는다(합치기는 지원하지 않는다).
export async function renameProduct(id: string, newName: string): Promise<{ error: string | null; updatedItems: number }> {
  await requirePermission('products:edit');
  const supabase = await createClient();
  const trimmed = newName.trim();
  if (!trimmed) return { error: '상품명을 입력해주세요.', updatedItems: 0 };

  const { data: current } = await supabase.from('products').select('name').eq('id', id).maybeSingle();
  if (!current) return { error: '상품을 찾지 못했습니다.', updatedItems: 0 };
  if (current.name === trimmed) return { error: null, updatedItems: 0 };

  const { error } = await supabase.from('products').update({ name: trimmed }).eq('id', id);
  if (error) return { error: error.code === '23505' ? '이미 등록된 상품명입니다.' : error.message, updatedItems: 0 };

  const { count, error: itemError } = await supabase
    .from('order_items')
    .update({ product_name_raw: trimmed }, { count: 'exact' })
    .eq('product_name_raw', current.name);
  if (itemError) {
    // 주문 이름 갱신에 실패하면 상품 이름도 되돌려서 둘이 어긋나지 않게 한다.
    await supabase.from('products').update({ name: current.name }).eq('id', id);
    return { error: itemError.message, updatedItems: 0 };
  }
  revalidate();
  return { error: null, updatedItems: count ?? 0 };
}
