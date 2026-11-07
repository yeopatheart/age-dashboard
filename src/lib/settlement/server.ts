// 정산 판매내역의 DB 조회(서버 전용). "출고 완료"는 대시보드와 같은 stageOfCard로 판정한다(정의가 어긋나지 않게).
// 월 조회는 카드가 수백~천 개라 id를 CHUNK개씩 나눠 조회한다(.in()에 한꺼번에 넣으면 요청 주소가 너무 길어진다).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll, mapChunks } from '@/lib/supabase/fetch-all';
import { stageOfCard, type LabelRow } from '@/lib/overview';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { buildSalesRows, type SalesRow, type SalesSourceCard, type SalesSourceItem, type StoredSale } from './sales';
import type { StoredPurchase } from './purchases';

type Client = SupabaseClient<Database>;
const CHUNK = 100;

export async function loadSalesRows(supabase: Client, from: string, to: string): Promise<SalesRow[]> {
  const [dailies, businesses, terminalsResult] = await Promise.all([
    fetchAll(
      (a, b) =>
        supabase
          .from('daily_businesses')
          .select('id, order_date, business_id, round, terminal_id, display_name, sort_order')
          .gte('order_date', from)
          .lte('order_date', to)
          .order('order_date')
          .order('id')
          .range(a, b),
      '업체 카드 조회 실패: ',
    ),
    fetchAll((a, b) => supabase.from('businesses').select('id, name').order('id').range(a, b), '업체 조회 실패: '),
    supabase.from('terminals').select('id, is_parcel'),
  ]);
  if (terminalsResult.error) throw new Error(`터미널 조회 실패: ${terminalsResult.error.message}`);
  if (dailies.length === 0) return [];
  const ids = dailies.map((d) => d.id);

  const [itemRows, labelRows, recordRows] = await Promise.all([
    mapChunks(ids, CHUNK, (chunk) =>
      fetchAll(
        (a, b) =>
          supabase
            .from('order_items')
            .select('id, daily_business_id, product_sequence, product_name_raw, quantity, unit, unshipped_quantity, is_packed, change_status')
            .in('daily_business_id', chunk)
            .order('id')
            .range(a, b),
        '주문 줄 조회 실패: ',
      ),
    ),
    mapChunks(ids, CHUNK, (chunk) => fetchAll((a, b) => supabase.from('box_labels').select('id, daily_business_id, seq, loaded_at').in('daily_business_id', chunk).order('id').range(a, b), '라벨 조회 실패: ')),
    mapChunks(ids, CHUNK, (chunk) => fetchAll((a, b) => supabase.from('packing_records').select('id, daily_business_id').in('daily_business_id', chunk).order('id').range(a, b), '박스 기록 조회 실패: ')),
  ]);
  const boxRows = await mapChunks(
    recordRows.map((r) => r.id),
    CHUNK,
    (chunk) => fetchAll((a, b) => supabase.from('packing_boxes').select('id, record_id').in('record_id', chunk).order('id').range(a, b), '박스 조회 실패: '),
  );

  // 박스 할당에서 제출한 박스 수(제출 기록이 있으면 0개여도 "제출됨"). 대시보드(overview/page.tsx)와 같은 방식이다.
  const dailyByRecord = new Map(recordRows.map((r) => [r.id, r.daily_business_id]));
  const submittedBoxes = new Map<string, number>(recordRows.map((r) => [r.daily_business_id, 0]));
  for (const box of boxRows) {
    const daily = dailyByRecord.get(box.record_id);
    if (daily) submittedBoxes.set(daily, (submittedBoxes.get(daily) ?? 0) + 1);
  }
  const labelsByDaily = new Map<string, LabelRow[]>();
  for (const l of labelRows) {
    const list = labelsByDaily.get(l.daily_business_id) ?? [];
    list.push({ seq: l.seq, loaded: !!l.loaded_at });
    labelsByDaily.set(l.daily_business_id, list);
  }
  const itemsByDaily = new Map<string, typeof itemRows>();
  for (const item of itemRows) itemsByDaily.set(item.daily_business_id, [...(itemsByDaily.get(item.daily_business_id) ?? []), item]);

  const parcelTerminals = new Set((terminalsResult.data ?? []).filter((t) => t.is_parcel).map((t) => t.id));
  const businessName = new Map(businesses.map((b) => [b.id, b.name]));
  const split = businessIdsInBothRounds(dailies.map((d) => ({ businessId: d.business_id, round: d.round })));

  const cards: SalesSourceCard[] = dailies.map((d) => {
    const { stage } = stageOfCard({
      items: (itemsByDaily.get(d.id) ?? []).map((i) => ({ changeStatus: i.change_status, isPacked: i.is_packed, quantity: Number(i.quantity), unit: i.unit, unshippedQuantity: Number(i.unshipped_quantity ?? 0) })),
      submittedBoxes: submittedBoxes.has(d.id) ? submittedBoxes.get(d.id)! : null,
      labels: labelsByDaily.get(d.id) ?? [],
      parcel: !!d.terminal_id && parcelTerminals.has(d.terminal_id),
    });
    const name = d.display_name ?? businessName.get(d.business_id) ?? '';
    return { id: d.id, orderDate: d.order_date, name: split.has(d.business_id) ? `${name} ${roundLabel(d.round)}` : name, sortOrder: d.sort_order, stage };
  });

  const items: SalesSourceItem[] = itemRows.map((i) => ({
    id: i.id,
    dailyBusinessId: i.daily_business_id,
    productSequence: i.product_sequence,
    productName: i.product_name_raw,
    quantity: Number(i.quantity),
    unit: i.unit,
    unshippedQuantity: Number(i.unshipped_quantity ?? 0),
    changeStatus: i.change_status,
  }));

  // 입력값은 출고 완료된 카드의 줄만 읽는다.
  const doneCardIds = new Set(cards.filter((c) => c.stage === 'done').map((c) => c.id));
  const doneItemIds = items.filter((i) => doneCardIds.has(i.dailyBusinessId)).map((i) => i.id);
  const stored: StoredSale[] = (
    await mapChunks(doneItemIds, CHUNK, (chunk) =>
      fetchAll((a, b) => supabase.from('settlement_sales').select('order_item_id, seller_id, price, unit_price, product_override, quantity_override, unit_override, paid, memo').in('order_item_id', chunk).order('order_item_id').range(a, b), '정산 입력값 조회 실패(마이그레이션 0043 적용 필요): '),
    )
  ).map((s) => ({ orderItemId: s.order_item_id, sellerId: s.seller_id, price: s.price === null ? null : Number(s.price), unitPrice: s.unit_price === null ? null : Number(s.unit_price), productOverride: s.product_override, quantityOverride: s.quantity_override === null ? null : Number(s.quantity_override), unitOverride: s.unit_override, paid: s.paid, memo: s.memo }));

  return buildSalesRows(cards, items, stored);
}

// 매입내역에 사용자가 입력해서 저장한 값(기간 안의 출고일). 행 목록은 판매내역에서 계산하고 여기서는 입력값만 읽는다.
export async function loadStoredPurchases(supabase: Client, from: string, to: string): Promise<StoredPurchase[]> {
  const rows = await fetchAll(
    (a, b) =>
      supabase
        .from('settlement_purchases')
        .select('order_date, product_name, seller_id, supplier_id, price, paid, memo')
        .gte('order_date', from)
        .lte('order_date', to)
        .order('order_date')
        .order('product_name')
        .range(a, b),
    '정산 매입 입력값 조회 실패: ',
  );
  return rows.map((r) => ({ orderDate: r.order_date, productName: r.product_name, sellerId: r.seller_id, supplierId: r.supplier_id, price: r.price === null ? null : Number(r.price), paid: r.paid, memo: r.memo }));
}

// 품목별 매입처 드롭다운에 쓰는 목록: 전체 매입처, 그리고 상품명 → 그 상품에 연결된 매입처 id들.
export interface SupplierDirectory {
  suppliers: { id: string; name: string }[];
  supplierIdsByProduct: Record<string, string[]>;
}

export async function loadSupplierDirectory(supabase: Client): Promise<SupplierDirectory> {
  const [suppliers, products, links] = await Promise.all([
    fetchAll((a, b) => supabase.from('suppliers').select('id, name').order('name').order('id').range(a, b), '매입처 조회 실패: '),
    fetchAll((a, b) => supabase.from('products').select('id, name').order('id').range(a, b), '상품 조회 실패: '),
    fetchAll((a, b) => supabase.from('product_suppliers').select('product_id, supplier_id').order('product_id').order('supplier_id').range(a, b), '상품 매입처 조회 실패: '),
  ]);
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  const supplierIdsByProduct: Record<string, string[]> = {};
  for (const l of links) {
    const name = nameById.get(l.product_id);
    if (name) (supplierIdsByProduct[name] ??= []).push(l.supplier_id);
  }
  return { suppliers, supplierIdsByProduct };
}
