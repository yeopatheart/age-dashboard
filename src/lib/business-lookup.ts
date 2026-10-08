import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

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

// 오늘자 daily_businesses 행을 찾거나, 없으면 assign_business_number로 번호를 발급받아 새로 만든다.
// 호출하는 쪽에서 같은 요청 안에 같은 업체가 여러 번 등장할 수 있다면(카카오 붙여넣기처럼
// 한 업체가 여러 상품 줄을 가질 때), 매번 새로 조회/삽입하면 daily_businesses의
// (order_date, business_id) unique 제약에 걸려 두 번째부터 조용히 실패할 수 있으므로
// 호출부에서 dailyBusinessId를 캐시해뒀다가 재사용해야 한다.
export async function findOrCreateDailyBusiness(
  supabase: SupabaseClient<Database>,
  orderDate: string,
  businessId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('daily_businesses')
    .select('id')
    .eq('order_date', orderDate)
    .eq('business_id', businessId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: businessNumber } = await supabase.rpc('assign_business_number', { p_order_date: orderDate });
  const { data: created } = await supabase
    .from('daily_businesses')
    .insert({ order_date: orderDate, business_id: businessId, business_number: businessNumber ?? 0 })
    .select('id')
    .single();
  return created?.id ?? null;
}
