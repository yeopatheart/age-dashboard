import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import type { OrderRound } from '@/lib/orders';

// 업체명으로 businesses.id를 찾거나 새로 만든다. 카카오 붙여넣기 확정(orders/actions.ts)과
// 대시보드의 "새 주문 추가" 모달(dashboard/actions.ts) 양쪽에서 같은 lookup-or-create가 필요해
// 여기로 뽑아뒀다.
export async function findOrCreateBusiness(
  supabase: SupabaseClient<Database>,
  businessName: string,
  terminalId: string | null,
  createdVia: 'order' | 'manual' = 'manual',
): Promise<string | null> {
  const { data: existing } = await supabase.from('businesses').select('id').eq('name', businessName).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('businesses')
    .insert({ name: businessName, terminal_id: terminalId, created_via: createdVia })
    .select('id')
    .single();
  if (error || !created) return null;
  return created.id;
}

// 그날 카드의 키 — 같은 날·차수에도 터미널이 다르면 별개 카드다(0029). 터미널이 없으면 빈 문자열.
export const dailyKey = (businessId: string, terminalId: string | null) => `${businessId}|${terminalId ?? ''}`;

// 별도 주문(is_separate) 터미널의 id 집합. 터미널이 없는 카드(null)는 일반 주문이라 포함하지 않는다.
export async function separateTerminalIds(supabase: SupabaseClient<Database>, terminalIds: (string | null)[]): Promise<Set<string>> {
  const ids = [...new Set(terminalIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.from('terminals').select('id').in('id', ids).eq('is_separate', true);
  if (error) throw new Error(`터미널 조회 실패: ${error.message}`);
  return new Set((data ?? []).map((t) => t.id));
}

// 업체 번호를 발급한다(0056). 일반 주문은 1번부터, 별도 주문은 501번부터 따로 센다 — 번호가 라벨 QR에 들어가 하루 안에서 겹치면 안 되기 때문이다.
export async function assignBusinessNumber(supabase: SupabaseClient<Database>, orderDate: string, separate: boolean): Promise<number> {
  const { data, error } = separate
    ? await supabase.rpc('assign_separate_business_number', { p_order_date: orderDate })
    : await supabase.rpc('assign_business_number', { p_order_date: orderDate });
  if (error || data === null) throw new Error(`업체 번호 발급 실패: ${error?.message ?? '응답 없음'}`);
  return data;
}

// 해당 날짜·차수·터미널의 daily_businesses 행을 찾거나, 없으면 번호를 발급받아(assignBusinessNumber) 새로 만든다.
// 호출하는 쪽에서 같은 요청 안에 같은 카드가 여러 번 등장할 수 있다면(카카오 붙여넣기처럼
// 한 업체가 여러 상품 줄을 가질 때), 매번 새로 조회/삽입하면 daily_businesses의
// (order_date, business_id, round, terminal) unique 제약에 걸려 두 번째부터 조용히 실패할 수 있으므로
// 호출부에서 dailyBusinessId를 캐시해뒀다가 재사용해야 한다.
export async function findOrCreateDailyBusiness(
  supabase: SupabaseClient<Database>,
  orderDate: string,
  businessId: string,
  round: OrderRound,
  terminalId: string | null,
): Promise<string | null> {
  const base = supabase.from('daily_businesses').select('id').eq('order_date', orderDate).eq('business_id', businessId).eq('round', round);
  const { data: existing } = await (terminalId ? base.eq('terminal_id', terminalId) : base.is('terminal_id', null)).maybeSingle();
  if (existing) return existing.id;

  let businessNumber: number;
  try {
    const separate = terminalId !== null && (await separateTerminalIds(supabase, [terminalId])).has(terminalId);
    businessNumber = await assignBusinessNumber(supabase, orderDate, separate);
  } catch (error) {
    console.error(error); // 호출부는 null을 "카드를 생성하지 못했습니다"로 알린다. 원인은 서버 로그에 남긴다.
    return null;
  }
  const { data: created } = await supabase
    .from('daily_businesses')
    .insert({ order_date: orderDate, business_id: businessId, business_number: businessNumber, round, terminal_id: terminalId })
    .select('id')
    .single();
  return created?.id ?? null;
}
