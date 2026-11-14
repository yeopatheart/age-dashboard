// 배송비 설정 조회(서버 전용): 터미널별 퀵 가능 여부, 고객사별 수단별 박스당 금액(마이그레이션 0062).
// 열이 아직 없으면 missingTable 오류가 그대로 던져진다 — 호출한 화면이 valueOrMissing으로 받아 설정 칸만 숨기고 나머지는 계속 쓴다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';
import type { ShippingRates } from './shipping';

type Client = SupabaseClient<Database>;

// 터미널 id → 퀵 가능 여부
export async function loadTerminalQuickAllowed(supabase: Client): Promise<Record<string, boolean>> {
  const rows = await fetchAll((a, b) => supabase.from('terminals').select('id, quick_allowed').order('id').range(a, b), '터미널 퀵 설정 조회 실패(마이그레이션 0062 적용 필요): ');
  return Object.fromEntries(rows.map((t) => [t.id, t.quick_allowed]));
}

// 고객사 id → 수단별 박스당 기본 금액(null이면 그 수단을 쓰지 않는다)
export async function loadBusinessShippingRates(supabase: Client): Promise<Record<string, ShippingRates>> {
  const rows = await fetchAll((a, b) => supabase.from('businesses').select('id, bus_rate, quick_rate, parcel_rate').order('id').range(a, b), '고객사 배송비 설정 조회 실패(마이그레이션 0062 적용 필요): ');
  return Object.fromEntries(rows.map((b) => [b.id, { bus: b.bus_rate, quick: b.quick_rate, parcel: b.parcel_rate }]));
}
