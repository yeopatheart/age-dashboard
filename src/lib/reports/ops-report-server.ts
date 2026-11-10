// 운영 개선 리포트용 조회(서버 전용). 계산은 unshipped.ts·settle-close.ts(순수 함수)가 한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll, mapChunks } from '@/lib/supabase/fetch-all';
import type { OrderLine } from './unshipped';

type Client = SupabaseClient<Database>;
const CHUNK = 100;

// 출고일이 from~to인 주문 줄(미출고 분석용). 고객명은 그날 카드 이름(없으면 고객사 이름)이다.
export async function loadOrderLines(supabase: Client, from: string, to: string): Promise<OrderLine[]> {
  const dailies = await fetchAll(
    (a, b) => supabase.from('daily_businesses').select('id, order_date, business_id, terminal_id, display_name').gte('order_date', from).lte('order_date', to).order('id').range(a, b),
    '업체 카드 조회 실패: ',
  );
  if (dailies.length === 0) return [];
  const [businesses, terminalsResult] = await Promise.all([
    fetchAll((a, b) => supabase.from('businesses').select('id, name').order('id').range(a, b), '업체 조회 실패: '),
    supabase.from('terminals').select('id, name'),
  ]);
  if (terminalsResult.error) throw new Error(`터미널 조회 실패: ${terminalsResult.error.message}`);
  const businessName = new Map(businesses.map((b) => [b.id, b.name]));
  const terminalName = new Map((terminalsResult.data ?? []).map((t) => [t.id, t.name]));
  const cardById = new Map(dailies.map((d) => [d.id, d]));

  const items = await mapChunks(dailies.map((d) => d.id), CHUNK, (chunk) =>
    fetchAll(
      (a, b) =>
        supabase
          .from('order_items')
          .select('id, daily_business_id, product_name_raw, quantity, unit, unshipped_quantity, unshipped_reason, change_status')
          .in('daily_business_id', chunk)
          .order('id')
          .range(a, b),
      '주문 줄 조회 실패: ',
    ),
  );
  return items.flatMap((i) => {
    const card = cardById.get(i.daily_business_id);
    if (!card) return [];
    return [
      {
        orderDate: card.order_date,
        customer: card.display_name ?? businessName.get(card.business_id) ?? '(이름 없음)',
        terminal: (card.terminal_id && terminalName.get(card.terminal_id)) || '미지정',
        product: i.product_name_raw,
        quantity: Number(i.quantity),
        unit: i.unit,
        unshipped: Number(i.unshipped_quantity),
        reason: i.unshipped_reason,
        cancelled: i.change_status === 'cancelled',
      },
    ];
  });
}

// 판매가를 입력한 판매내역 줄의 마지막 입력 시각(updated_at). 키는 주문 줄 id.
export async function loadSalesInputTimes(supabase: Client, itemIds: string[]): Promise<Map<string, number>> {
  const rows = await mapChunks(itemIds, CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('settlement_sales').select('order_item_id, updated_at').in('order_item_id', chunk).order('order_item_id').range(a, b), '판매 입력 시각 조회 실패: '),
  );
  return new Map(rows.map((r) => [r.order_item_id, Date.parse(r.updated_at)]));
}

// 매입가 입력 시각(updated_at). 키는 `출고일|품목`.
export async function loadPurchaseInputTimes(supabase: Client, from: string, to: string): Promise<Map<string, number>> {
  const rows = await fetchAll(
    (a, b) => supabase.from('settlement_purchases').select('order_date, product_name, updated_at').gte('order_date', from).lte('order_date', to).order('order_date').order('product_name').range(a, b),
    '매입 입력 시각 조회 실패: ',
  );
  return new Map(rows.map((r) => [`${r.order_date}|${r.product_name}`, Date.parse(r.updated_at)]));
}
