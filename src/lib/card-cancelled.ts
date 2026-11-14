import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

// 주문 상품이 모두 취소된 업체 카드의 id. 이런 고객사는 박스 할당·라벨 출력·상차가 필요 없어서 서버가 라벨 준비·상차 스캔에서 걸러 낸다.
// 화면이 쓰는 규칙(orders.ts의 isCardCancelled)과 같다: 상품이 하나 이상이고 전부 취소.
export async function cancelledCardIds(supabase: SupabaseClient<Database>, dailyBusinessIds: string[]): Promise<Set<string>> {
  if (dailyBusinessIds.length === 0) return new Set();
  const { data } = await supabase.from('order_items').select('daily_business_id, change_status').in('daily_business_id', dailyBusinessIds).limit(10000);
  const live = new Set<string>();
  const seen = new Set<string>();
  for (const row of data ?? []) {
    seen.add(row.daily_business_id);
    if (row.change_status !== 'cancelled') live.add(row.daily_business_id);
  }
  return new Set([...seen].filter((id) => !live.has(id)));
}
