// 정산 판매내역의 DB 조회(서버 전용). "출고 완료"는 대시보드와 같은 stageOfCard로 판정한다(정의가 어긋나지 않게).
// 월 조회는 카드가 수백~천 개라 id를 CHUNK개씩 나눠 조회한다(.in()에 한꺼번에 넣으면 요청 주소가 너무 길어진다).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll, mapChunks } from '@/lib/supabase/fetch-all';
import { stageOfCard, type LabelRow } from '@/lib/overview';
import { businessIdsInBothRounds, roundLabel } from '@/lib/orders';
import { buildSalesRows, type SalesRow, type SalesSourceCard, type SalesSourceItem, type StoredSale } from './sales';
import { paymentKey } from './purchases';
import { priceKey, type PriceEntry } from './pricing';
import { missingTable } from '@/lib/supabase/missing-table';
import { buildShippingRows, ratesFor, type ShippingCard, type ShippingRow, type StoredShipping, type ShippingMethod } from './shipping';

type Client = SupabaseClient<Database>;
const CHUNK = 100;

// 고객사의 사업자구분(0063) → 정산 사업자 구분 기본값. 열이 아직 없으면(마이그레이션 전) 기본값 없이 계속한다.
async function loadBusinessSellerDefaults(supabase: Client): Promise<Map<string, string>> {
  try {
    const rows = await fetchAll((a, b) => supabase.from('businesses').select('id, seller_id').order('id').range(a, b), '고객사 사업자구분 조회 실패: ');
    return new Map(rows.flatMap((b) => (b.seller_id ? [[b.id, b.seller_id] as [string, string]] : [])));
  } catch (e) {
    if (missingTable(e) !== null) return new Map();
    throw e;
  }
}

// 출고 완료된 그날 고객 카드(배송비를 붙이는 단위). 판매내역과 같은 stageOfCard 판정을 쓴다.
export interface DoneCard {
  id: string;
  orderDate: string;
  name: string; // 판매내역에 보이는 고객명(차수 표시 포함)
  businessId: string;
  terminalId: string | null;
  terminal: string;
  boxes: number; // 제출한 박스 수(택배는 제출 전이면 1)
  sellerId: string | null; // 고객 카드의 사업자구분(없으면 고객사 기본값)
  paid: boolean | null; // 고객 카드의 입금 여부. null = settlement_cards 테이블이 아직 없음(마이그레이션 0064 전)
}

export async function loadSalesRows(supabase: Client, from: string, to: string): Promise<SalesRow[]> {
  return (await loadSalesAndCards(supabase, from, to)).rows;
}

// 고객 카드 단위로 정한 사업자·입금(0064). 테이블이 아직 없으면 null(예전처럼 줄에 저장한 값을 쓴다).
async function loadCardSettings(supabase: Client, cardIds: string[]): Promise<Map<string, { sellerId: string | null; paid: boolean }> | null> {
  try {
    const rows = await mapChunks(cardIds, CHUNK, (chunk) =>
      fetchAll((a, b) => supabase.from('settlement_cards').select('daily_business_id, seller_id, paid').in('daily_business_id', chunk).order('daily_business_id').range(a, b), '정산 고객 설정 조회 실패: '),
    );
    return new Map(rows.map((r) => [r.daily_business_id, { sellerId: r.seller_id, paid: r.paid }]));
  } catch (e) {
    if (missingTable(e) !== null) return null;
    throw e;
  }
}

export async function loadSalesAndCards(supabase: Client, from: string, to: string): Promise<{ rows: SalesRow[]; doneCards: DoneCard[]; cardSettingsAvailable: boolean; purchaseAvailable: boolean; prices: StoredPrice[] }> {
  const [dailies, businesses, terminalsResult, sellerDefaults] = await Promise.all([
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
    supabase.from('terminals').select('id, name, is_parcel'),
    loadBusinessSellerDefaults(supabase),
  ]);
  if (terminalsResult.error) throw new Error(`터미널 조회 실패: ${terminalsResult.error.message}`);
  if (dailies.length === 0) return { rows: [], doneCards: [], cardSettingsAvailable: true, purchaseAvailable: true, prices: [] };
  const ids = dailies.map((d) => d.id);

  const [itemRows, labelRows, recordRows, cardSettings] = await Promise.all([
    mapChunks(ids, CHUNK, (chunk) =>
      fetchAll(
        (a, b) =>
          supabase
            .from('order_items')
            .select('id, daily_business_id, product_sequence, product_name_raw, quantity, unit, unshipped_quantity, is_packed, change_status, secondary_weight_kg')
            .in('daily_business_id', chunk)
            .order('id')
            .range(a, b),
        '주문 줄 조회 실패: ',
      ),
    ),
    mapChunks(ids, CHUNK, (chunk) => fetchAll((a, b) => supabase.from('box_labels').select('id, daily_business_id, seq, loaded_at').in('daily_business_id', chunk).order('id').range(a, b), '라벨 조회 실패: ')),
    mapChunks(ids, CHUNK, (chunk) => fetchAll((a, b) => supabase.from('packing_records').select('id, daily_business_id').in('daily_business_id', chunk).order('id').range(a, b), '박스 기록 조회 실패: ')),
    loadCardSettings(supabase, ids),
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

  const terminalName = new Map((terminalsResult.data ?? []).map((t) => [t.id, t.name]));
  const parcelTerminals = new Set((terminalsResult.data ?? []).filter((t) => t.is_parcel).map((t) => t.id));
  const businessName = new Map(businesses.map((b) => [b.id, b.name]));
  const split = businessIdsInBothRounds(dailies.map((d) => ({ businessId: d.business_id, round: d.round })));

  const parcelOf = (terminalId: string | null) => !!terminalId && parcelTerminals.has(terminalId);
  const cards: SalesSourceCard[] = dailies.map((d) => {
    const { stage } = stageOfCard({
      items: (itemsByDaily.get(d.id) ?? []).map((i) => ({ changeStatus: i.change_status, isPacked: i.is_packed, quantity: Number(i.quantity), unit: i.unit, unshippedQuantity: Number(i.unshipped_quantity ?? 0) })),
      submittedBoxes: submittedBoxes.has(d.id) ? submittedBoxes.get(d.id)! : null,
      labels: labelsByDaily.get(d.id) ?? [],
      parcel: parcelOf(d.terminal_id),
    });
    const name = d.display_name ?? businessName.get(d.business_id) ?? '';
    return { id: d.id, orderDate: d.order_date, name: split.has(d.business_id) ? `${name} ${roundLabel(d.round)}` : name, sortOrder: d.sort_order, stage, defaultSellerId: sellerDefaults.get(d.business_id) ?? null, settings: cardSettings ? (cardSettings.get(d.id) ?? { sellerId: null, paid: false }) : null, terminal: (d.terminal_id && terminalName.get(d.terminal_id)) || '미지정' };
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
    secondaryWeightKg: i.secondary_weight_kg === null || i.secondary_weight_kg === undefined ? null : Number(i.secondary_weight_kg),
  }));

  // 입력값은 출고 완료된 카드의 줄만 읽는다.
  const doneCardIds = new Set(cards.filter((c) => c.stage === 'done').map((c) => c.id));
  const doneItemIds = items.filter((i) => doneCardIds.has(i.dailyBusinessId)).map((i) => i.id);
  // 줄 단위 매입 열(0065)이 아직 없으면 그 열 없이 다시 읽는다(정산표는 계속 쓸 수 있고, 매입은 단가표·줄 값 없이 비어 있다).
  type StoredRow = { order_item_id: string; seller_id: string | null; price: number | null; unit_price: number | null; product_override: string | null; quantity_override: number | null; unit_override: string | null; paid: boolean; memo: string | null; supplier_id?: string | null; purchase_unit_price?: number | null; purchase_price?: number | null };
  const readStoredFull = (): Promise<StoredRow[]> =>
    mapChunks(doneItemIds, CHUNK, (chunk) =>
      fetchAll((a, b) => supabase.from('settlement_sales').select('order_item_id, seller_id, price, unit_price, product_override, quantity_override, unit_override, paid, memo, supplier_id, purchase_unit_price, purchase_price').in('order_item_id', chunk).order('order_item_id').range(a, b), '정산 입력값 조회 실패(마이그레이션 0043 적용 필요): '),
    );
  const readStoredBasic = (): Promise<StoredRow[]> =>
    mapChunks(doneItemIds, CHUNK, (chunk) =>
      fetchAll((a, b) => supabase.from('settlement_sales').select('order_item_id, seller_id, price, unit_price, product_override, quantity_override, unit_override, paid, memo').in('order_item_id', chunk).order('order_item_id').range(a, b), '정산 입력값 조회 실패(마이그레이션 0043 적용 필요): '),
    );
  let storedRows: StoredRow[];
  let purchaseAvailable = true;
  try {
    storedRows = await readStoredFull();
  } catch (e) {
    if (missingTable(e) !== 'settlement_purchase_lines') throw e;
    purchaseAvailable = false;
    storedRows = await readStoredBasic();
  }
  const stored: StoredSale[] = storedRows.map((s) => ({
    orderItemId: s.order_item_id,
    sellerId: s.seller_id,
    price: s.price === null ? null : Number(s.price),
    unitPrice: s.unit_price === null ? null : Number(s.unit_price),
    supplierId: s.supplier_id ?? null,
    purchaseUnitPrice: s.purchase_unit_price == null ? null : Number(s.purchase_unit_price),
    purchasePrice: s.purchase_price == null ? null : Number(s.purchase_price),
    productOverride: s.product_override,
    quantityOverride: s.quantity_override === null ? null : Number(s.quantity_override),
    unitOverride: s.unit_override,
    paid: s.paid,
    memo: s.memo,
  }));
  const priceRows = await loadPrices(supabase, from, to);
  const priceMap = new Map<string, PriceEntry>((priceRows ?? []).map((p) => [priceKey(p.orderDate, p.product), p]));

  const doneCards: DoneCard[] = dailies.flatMap((d, i) =>
    cards[i].stage === 'done'
      ? [{ id: d.id, orderDate: d.order_date, name: cards[i].name, businessId: d.business_id, terminalId: d.terminal_id, terminal: cards[i].terminal, boxes: submittedBoxes.get(d.id) ?? (parcelOf(d.terminal_id) ? 1 : 0), sellerId: cards[i].settings?.sellerId ?? cards[i].defaultSellerId, paid: cards[i].settings ? cards[i].settings.paid : null }]
      : [],
  );
  return { rows: buildSalesRows(cards, items, stored, priceMap), doneCards, cardSettingsAvailable: cardSettings !== null, purchaseAvailable: purchaseAvailable && priceRows !== null, prices: priceRows ?? [] };
}

// 정산 배송비 줄: 출고 완료 카드마다 저장한 값 + 설정(터미널 박스당 금액·퀵 가능, 고객사 퀵 이용)으로 자동 산정한 줄.
// 설정 열(0062)이나 settlement_shipping 테이블이 없으면 missingTable 오류가 그대로 던져진다(호출한 화면이 rowsOrMissing로 안내한다).
export async function loadShippingRows(supabase: Client, doneCards: DoneCard[], sales: SalesRow[]): Promise<{ rows: ShippingRow[]; cards: ShippingCard[] }> {
  if (doneCards.length === 0) return { rows: [], cards: [] };
  const [terminals, businesses] = await Promise.all([
    fetchAll((a, b) => supabase.from('terminals').select('id, is_parcel, quick_allowed, bus_rate, quick_rate, parcel_rate').order('id').range(a, b), '터미널 배송비 설정 조회 실패(마이그레이션 0062·0063 적용 필요): '),
    fetchAll((a, b) => supabase.from('businesses').select('id, seller_id, uses_quick').order('id').range(a, b), '고객사 정산 설정 조회 실패(마이그레이션 0063 적용 필요): '),
  ]);
  const stored: StoredShipping[] = (
    await mapChunks(
      doneCards.map((c) => c.id),
      CHUNK,
      (chunk) => fetchAll((a, b) => supabase.from('settlement_shipping').select('id, daily_business_id, method, boxes, amount, seller_id, paid, memo').in('daily_business_id', chunk).order('id').range(a, b), '정산 배송비 조회 실패(마이그레이션 0062 적용 필요): '),
    )
  ).map((r) => ({ id: r.id, cardId: r.daily_business_id, method: r.method as ShippingMethod, boxes: r.boxes, amount: Number(r.amount), sellerId: r.seller_id, paid: r.paid, memo: r.memo }));

  const terminalById = new Map(terminals.map((t) => [t.id, t]));
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  // 그 고객의 판매 줄 사업자(같은 출고일·고객명의 첫 사업자)
  const sellerByCustomer = new Map<string, string>();
  for (const r of sales) if (r.sellerId && !sellerByCustomer.has(`${r.orderDate}|${r.customer}`)) sellerByCustomer.set(`${r.orderDate}|${r.customer}`, r.sellerId);

  const cards: ShippingCard[] = doneCards.map((c) => {
    const terminal = c.terminalId ? terminalById.get(c.terminalId) : undefined;
    const business = businessById.get(c.businessId);
    return {
      cardId: c.id,
      orderDate: c.orderDate,
      customer: c.name,
      terminal: c.terminal,
      quickAllowed: terminal?.quick_allowed ?? true,
      boxes: c.boxes,
      // 터미널이 없는('미지정') 카드는 제안할 금액이 없다.
      rates: terminal
        ? ratesFor({ isParcel: terminal.is_parcel, quickAllowed: terminal.quick_allowed, bus: terminal.bus_rate, quick: terminal.quick_rate, parcel: terminal.parcel_rate }, business?.uses_quick ?? false)
        : { bus: null, quick: null, parcel: null },
      // 카드 단위 설정(0064)이 있으면 그 값, 아직 없으면 예전처럼 그 고객의 판매 줄 사업자를 따른다.
      sellerId: c.paid !== null ? c.sellerId : (sellerByCustomer.get(`${c.orderDate}|${c.name}`) ?? business?.seller_id ?? null),
      paid: c.paid,
    };
  });
  return { rows: buildShippingRows(cards, stored), cards };
}

// 날짜별 품목 단가표(0065). 테이블이 아직 없으면 null(마이그레이션 전: 단가표 없이 줄 값만 쓴다).
export interface StoredPrice extends PriceEntry {
  orderDate: string;
  product: string;
}

export async function loadPrices(supabase: Client, from: string, to: string): Promise<StoredPrice[] | null> {
  try {
    const rows = await fetchAll(
      (a, b) => supabase.from('settlement_prices').select('order_date, product_name, sale_unit_price, supplier_id, purchase_unit_price').gte('order_date', from).lte('order_date', to).order('order_date').order('product_name').range(a, b),
      '정산 품목 단가표 조회 실패: ',
    );
    return rows.map((r) => ({ orderDate: r.order_date, product: r.product_name, saleUnitPrice: r.sale_unit_price === null ? null : Number(r.sale_unit_price), supplierId: r.supplier_id, purchaseUnitPrice: r.purchase_unit_price === null ? null : Number(r.purchase_unit_price) }));
  } catch (e) {
    if (missingTable(e) !== null) return null;
    throw e;
  }
}

// 매입처별 지급 체크(0065) → `출고일|매입처` 키 집합(지급한 것만). 테이블이 없으면 null.
export async function loadSupplierPayments(supabase: Client, from: string, to: string): Promise<Set<string> | null> {
  try {
    const rows = await fetchAll(
      (a, b) => supabase.from('settlement_supplier_payments').select('order_date, supplier_id, paid').gte('order_date', from).lte('order_date', to).order('order_date').order('supplier_id').range(a, b),
      '매입처 지급 조회 실패: ',
    );
    return new Set(rows.filter((r) => r.paid).map((r) => paymentKey(r.order_date, r.supplier_id)));
  } catch (e) {
    if (missingTable(e) !== null) return null;
    throw e;
  }
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
