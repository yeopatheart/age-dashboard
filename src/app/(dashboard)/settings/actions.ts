'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { mergeSettings, type AppSettings } from '@/lib/app-settings';
import { parseSizeSpec } from '@/lib/size-spec';
import { requirePermission } from '@/lib/permissions/access';

// 설정 저장. 값은 서버에서 한 번 더 검증(범위를 벗어나면 기본값)한 뒤 키마다 한 행씩 저장한다.
export async function saveSettings(input: AppSettings): Promise<{ error: string | null; settings: AppSettings }> {
  await requirePermission('settings:edit');
  const supabase = await createClient();
  const settings = mergeSettings(input as unknown as Record<string, unknown>);
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) return { error: error.message, settings };
  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/orders/new');
  return { error: null, settings };
}

// 요구사항 해석 값(size_spec)은 주문 저장 시점의 설정으로 계산해서 저장해 둔다. 설정(허용 오차 등)을 바꾼 뒤에
// 이미 저장된 주문에도 새 설정을 적용하고 싶을 때 쓴다. 서로 다른 표기 문자열마다 한 번씩만 갱신한다.
export async function reapplySizeSpecs(): Promise<{ error: string | null; updated: number }> {
  await requirePermission('settings:edit');
  const supabase = await createClient();
  const settings = await loadAppSettings(supabase);

  const distinct = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('order_items')
      .select('size_request')
      .not('size_request', 'is', null)
      .range(from, from + 999);
    if (error) return { error: error.message, updated: 0 };
    for (const r of data ?? []) if (r.size_request) distinct.add(r.size_request);
    if (!data || data.length < 1000) break;
  }

  const results = await Promise.all(
    [...distinct].map((raw) =>
      supabase.from('order_items').update({ size_spec: parseSizeSpec(raw, settings) }, { count: 'exact' }).eq('size_request', raw),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message, updated: 0 };
  revalidatePath('/dashboard');
  return { error: null, updated: results.reduce((sum, r) => sum + (r.count ?? 0), 0) };
}
