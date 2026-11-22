'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { isHueKey } from '@/lib/color-palette';
import { STICKER_DEFAULT_COLOR, movedOrder, normalizeStickerLabel } from '@/lib/stickers';

// 같은 이름이 이미 있으면 DB의 unique 인덱스(sticker_presets_label_key)가 막는다(23505).
const DUPLICATE = '같은 이름의 스티커가 이미 있습니다.';
const isDuplicate = (error: { code?: string }) => error.code === '23505';

function refresh() {
  revalidatePath('/stickers');
  revalidatePath('/dashboard');
}

export async function createSticker(label: string, usesQuantity: boolean): Promise<{ error: string | null }> {
  await requirePermission('stickers:edit');
  const normalized = normalizeStickerLabel(label);
  if (!normalized.ok) return { error: normalized.error };
  const supabase = await createClient();
  // 새 스티커는 맨 뒤에 둔다.
  const { data: last, error: lastError } = await supabase.from('sticker_presets').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  if (lastError) return { error: lastError.message };
  const sortOrder = (last?.[0]?.sort_order ?? 0) + 1;
  const { error } = await supabase
    .from('sticker_presets')
    .insert({ label: normalized.label, uses_quantity: usesQuantity, sort_order: sortOrder, fill_color: STICKER_DEFAULT_COLOR, border_color: STICKER_DEFAULT_COLOR });
  if (error) return { error: isDuplicate(error) ? DUPLICATE : error.message };
  refresh();
  return { error: null };
}

export async function updateSticker(id: string, label: string, usesQuantity: boolean): Promise<{ error: string | null }> {
  await requirePermission('stickers:edit');
  const normalized = normalizeStickerLabel(label);
  if (!normalized.ok) return { error: normalized.error };
  const supabase = await createClient();
  const { error } = await supabase.from('sticker_presets').update({ label: normalized.label, uses_quantity: usesQuantity }).eq('id', id);
  if (error) return { error: isDuplicate(error) ? DUPLICATE : error.message };
  refresh();
  return { error: null };
}

// 색상은 palette key(src/lib/color-palette.ts)로만 저장한다. 모르는 key는 받지 않는다.
export async function setStickerColor(id: string, fill: string | null, border: string | null): Promise<{ error: string | null }> {
  await requirePermission('stickers:edit');
  if (!isHueKey(fill) || !isHueKey(border)) return { error: '팔레트에 없는 색입니다.' };
  const supabase = await createClient();
  const { error } = await supabase.from('sticker_presets').update({ fill_color: fill, border_color: border }).eq('id', id);
  if (error) return { error: error.message };
  refresh();
  return { error: null };
}

// 한 칸 위/아래로 옮긴다: 현재 순서를 읽어 바뀐 순서대로 sort_order를 1부터 다시 매긴다(두 행이 같은 값이어도 어긋나지 않게).
export async function moveSticker(id: string, direction: 'up' | 'down'): Promise<{ error: string | null }> {
  await requirePermission('stickers:edit');
  const supabase = await createClient();
  const { data, error } = await supabase.from('sticker_presets').select('id').order('sort_order').order('created_at');
  if (error) return { error: error.message };
  const next = movedOrder((data ?? []).map((r) => r.id), id, direction);
  if (!next) return { error: null };
  const results = await Promise.all(next.map((sid, i) => supabase.from('sticker_presets').update({ sort_order: i + 1 }).eq('id', sid)));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  refresh();
  return { error: null };
}

export async function deleteSticker(id: string): Promise<{ error: string | null }> {
  await requirePermission('stickers:delete');
  const supabase = await createClient();
  const { error } = await supabase.from('sticker_presets').delete().eq('id', id);
  if (error) return { error: error.message };
  refresh();
  return { error: null };
}
