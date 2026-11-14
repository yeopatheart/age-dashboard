// 배송비·고객사 정산 설정 조회(서버 전용): 터미널별 퀵 가능 여부와 수단별 박스당 금액(0062·0063), 고객사별 사업자명·사업자구분·퀵 이용(0063).
// 열이 아직 없으면 missingTable 오류가 그대로 던져진다 — 호출한 화면이 valueOrMissing으로 받아 설정 칸만 숨기고 나머지는 계속 쓴다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';
import type { TerminalShipping } from './shipping';

type Client = SupabaseClient<Database>;

// 터미널 id → 퀵 가능 여부와 수단별 박스당 기본 금액(null이면 제안하지 않음)
export async function loadTerminalShipping(supabase: Client): Promise<Record<string, TerminalShipping>> {
  const rows = await fetchAll((a, b) => supabase.from('terminals').select('id, quick_allowed, bus_rate, quick_rate, parcel_rate').order('id').range(a, b), '터미널 배송비 설정 조회 실패(마이그레이션 0062·0063 적용 필요): ');
  return Object.fromEntries(rows.map((t) => [t.id, { quickAllowed: t.quick_allowed, bus: t.bus_rate, quick: t.quick_rate, parcel: t.parcel_rate }]));
}

// 고객사 id → 사업자명·사업자구분(seller_businesses id)·퀵 이용
export interface BusinessFields {
  legalName: string | null;
  sellerId: string | null;
  usesQuick: boolean;
}

export async function loadBusinessFields(supabase: Client): Promise<Record<string, BusinessFields>> {
  const rows = await fetchAll((a, b) => supabase.from('businesses').select('id, legal_name, seller_id, uses_quick').order('id').range(a, b), '고객사 정산 설정 조회 실패(마이그레이션 0063 적용 필요): ');
  return Object.fromEntries(rows.map((b) => [b.id, { legalName: b.legal_name, sellerId: b.seller_id, usesQuick: b.uses_quick }]));
}
