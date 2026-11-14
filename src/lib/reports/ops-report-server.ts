// 운영 개선 리포트용 조회(서버 전용). 계산은 unshipped.ts·settle-close.ts(순수 함수)가 한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll, mapChunks } from '@/lib/supabase/fetch-all';
import type { InputLine, Paste } from './input-quality';
import type { LabelRec } from './label-quality';
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

// 매입 단가 입력 시각(품목 단가표의 updated_at, 0065). 키는 `출고일|품목`. 매입 단가를 넣은 행만 센다. 테이블이 없으면 missingTable 오류를 던진다.
export async function loadPurchaseInputTimes(supabase: Client, from: string, to: string): Promise<Map<string, number>> {
  const rows = await fetchAll(
    (a, b) => supabase.from('settlement_prices').select('order_date, product_name, updated_at').not('purchase_unit_price', 'is', null).gte('order_date', from).lte('order_date', to).order('order_date').order('product_name').range(a, b),
    '매입 입력 시각 조회 실패: ',
  );
  return new Map(rows.map((r) => [`${r.order_date}|${r.product_name}`, Date.parse(r.updated_at)]));
}

// ─── 주문 입력 품질 · 라벨·상차 품질용 ────────────────────────────────────────

interface CardInfo {
  orderDate: string;
  customer: string;
  terminal: string;
}

// 출고일이 from~to인 업체 카드의 날짜·고객명·터미널(고객명은 그날 카드 이름, 없으면 고객사 이름).
async function loadCardIndex(supabase: Client, from: string, to: string): Promise<Map<string, CardInfo>> {
  const dailies = await fetchAll(
    (a, b) => supabase.from('daily_businesses').select('id, order_date, business_id, terminal_id, display_name').gte('order_date', from).lte('order_date', to).order('id').range(a, b),
    '업체 카드 조회 실패: ',
  );
  if (dailies.length === 0) return new Map();
  const [businesses, terminalsResult] = await Promise.all([
    fetchAll((a, b) => supabase.from('businesses').select('id, name').order('id').range(a, b), '업체 조회 실패: '),
    supabase.from('terminals').select('id, name'),
  ]);
  if (terminalsResult.error) throw new Error(`터미널 조회 실패: ${terminalsResult.error.message}`);
  const businessName = new Map(businesses.map((b) => [b.id, b.name]));
  const terminalName = new Map((terminalsResult.data ?? []).map((t) => [t.id, t.name]));
  return new Map(
    dailies.map((d) => [
      d.id,
      { orderDate: d.order_date, customer: d.display_name ?? businessName.get(d.business_id) ?? '(이름 없음)', terminal: (d.terminal_id && terminalName.get(d.terminal_id)) || '미지정' },
    ]),
  );
}

// 주문 입력 품질용 주문 줄(취소 포함). ai_repaired는 마이그레이션 0055가 더한 열이다(없으면 호출하는 쪽이 rowsOrMissing으로 안내).
export async function loadInputLines(supabase: Client, from: string, to: string): Promise<InputLine[]> {
  const cards = await loadCardIndex(supabase, from, to);
  if (cards.size === 0) return [];
  const items = await mapChunks([...cards.keys()], CHUNK, (chunk) =>
    fetchAll(
      (a, b) =>
        supabase
          .from('order_items')
          .select('id, daily_business_id, product_name_raw, needs_review, review_reason, ai_repaired, change_status')
          .in('daily_business_id', chunk)
          .order('id')
          .range(a, b),
      '주문 줄 조회 실패: ',
    ),
  );
  return items.flatMap((i) => {
    const card = cards.get(i.daily_business_id);
    return card
      ? [{ orderDate: card.orderDate, customer: card.customer, terminal: card.terminal, product: i.product_name_raw, needsReview: i.needs_review, reviewReason: i.review_reason, aiRepaired: i.ai_repaired, changeStatus: i.change_status }]
      : [];
  });
}

// 카카오 붙여넣기 기록(주문 입력을 확정할 때마다 한 줄). 출고일과 차수만 쓴다.
export async function loadPastes(supabase: Client, from: string, to: string): Promise<Paste[]> {
  const rows = await fetchAll(
    (a, b) => supabase.from('kakao_message_log').select('id, order_date, round').gte('order_date', from).lte('order_date', to).order('id').range(a, b),
    '카카오 붙여넣기 기록 조회 실패: ',
  );
  return rows.map((r) => ({ orderDate: r.order_date, round: r.round === 2 ? 2 : 1 }));
}

// 라벨(박스)마다 출력·스캔·되돌리기 이벤트 수. 출고일 기준으로 카드에 묶는다.
export async function loadLabelRecs(supabase: Client, from: string, to: string): Promise<LabelRec[]> {
  const cards = await loadCardIndex(supabase, from, to);
  if (cards.size === 0) return [];
  const labels = await mapChunks([...cards.keys()], CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('box_labels').select('id, daily_business_id').in('daily_business_id', chunk).order('id').range(a, b), '라벨 조회 실패: '),
  );
  if (labels.length === 0) return [];
  const events = await mapChunks(labels.map((l) => l.id), CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('box_label_events').select('id, label_id, event').in('label_id', chunk).order('id').range(a, b), '라벨 이벤트 조회 실패: '),
  );
  const counts = new Map<string, { prints: number; scans: number; undos: number }>();
  for (const e of events) {
    const c = counts.get(e.label_id) ?? { prints: 0, scans: 0, undos: 0 };
    if (e.event === 'print') c.prints += 1;
    else if (e.event === 'scan') c.scans += 1;
    else if (e.event === 'undo') c.undos += 1;
    counts.set(e.label_id, c);
  }
  return labels.flatMap((l) => {
    const card = cards.get(l.daily_business_id);
    const c = counts.get(l.id) ?? { prints: 0, scans: 0, undos: 0 };
    return card ? [{ cardId: l.daily_business_id, orderDate: card.orderDate, customer: card.customer, ...c }] : [];
  });
}
