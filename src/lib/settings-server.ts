import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { mergeSettings, type AppSettings } from '@/lib/app-settings';

// app_settings 전체를 읽어 기본값과 합친다. 테이블이 아직 없거나 비어 있으면 기본값을 돌려준다.
export async function loadAppSettings(supabase: SupabaseClient<Database>): Promise<AppSettings> {
  const { data } = await supabase.from('app_settings').select('key, value');
  return mergeSettings(Object.fromEntries((data ?? []).map((r) => [r.key, r.value])));
}
