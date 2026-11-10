'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { loadSalesRows } from '@/lib/settlement/server';
import { buildSnapshot, groupForReceipts, type ReceiptSeller, type ReceiptSkipReason, type ReceiptSnapshot, type ReceiptSourceRow } from '@/lib/settlement/receipt';
import { migrationsFor, missingTable } from '@/lib/supabase/missing-table';
import { isIsoDate } from '@/lib/validate';

const MAX_ITEMS = 2000;
const MAX_SPAN_DAYS = 62; // 판매내역 월 조회보다 넓게는 읽지 않는다(출고 완료 줄을 날짜 범위로 다시 계산하므로)

export interface IssuedReceipt {
  id: string;
  receiptNo: number;
  sellerId: string;
  snapshot: ReceiptSnapshot;
}

export interface SkippedLine {
  orderDate: string;
  customer: string;
  product: string;
  reason: ReceiptSkipReason;
}

export interface IssueResult {
  error: string | null;
  receipts: IssuedReceipt[];
  seals: Record<string, string | null>; // 사업자 id → 직인 PNG data URL(미리보기·이미지에 쓴다)
  skipped: SkippedLine[];
  notFound: number; // 선택했지만 서버가 판매내역 줄로 확인하지 못한 줄 수(그 사이 주문이 바뀐 경우)
}

const fail = (error: string): IssueResult => ({ error, receipts: [], seals: {}, skipped: [], notFound: 0 });

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

// 선택한 판매내역 줄로 영수증을 발행한다(고객사 × 사업자 × 출고일마다 한 장). 줄은 화면에서 보낸 값이 아니라 서버가 DB에서 다시 읽은 값으로 만든다.
// 발행한 내용(품목·금액·공급자 정보)은 settlement_receipts에 스냅샷으로 저장되고, 화면은 이 결과로 이미지를 만든다.
export async function issueReceipts(input: { itemIds: string[]; from: string; to: string }): Promise<IssueResult> {
  await requirePermission('settlement:edit');
  const ids = [...new Set(input.itemIds)];
  if (ids.length === 0) return fail('영수증을 만들 줄을 선택해주세요.');
  if (ids.length > MAX_ITEMS) return fail(`한 번에 ${MAX_ITEMS.toLocaleString('ko-KR')}줄까지만 만들 수 있습니다.`);
  if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.from > input.to) return fail('기간이 올바르지 않습니다.');
  if (daysBetween(input.from, input.to) > MAX_SPAN_DAYS) return fail('조회 기간이 너무 깁니다. 기간을 줄여 다시 시도해주세요.');

  const supabase = await createClient();
  try {
    const wanted = new Set(ids);
    const sales = (await loadSalesRows(supabase, input.from, input.to)).filter((r) => wanted.has(r.itemId));
    const sources: ReceiptSourceRow[] = sales.map((r) => ({
      itemId: r.itemId,
      orderDate: r.orderDate,
      customer: r.customer,
      product: r.product,
      quantity: r.quantity,
      unit: r.unit,
      sellerId: r.sellerId,
      price: r.price,
      unitPrice: r.unitPrice,
    }));
    const notFound = ids.length - sources.length;
    const { groups, skipped } = groupForReceipts(sources);
    const skippedLines: SkippedLine[] = skipped.map((s) => ({ orderDate: s.row.orderDate, customer: s.row.customer, product: s.row.product, reason: s.reason }));
    if (groups.length === 0) {
      return { ...fail('발행할 수 있는 줄이 없습니다. 선택한 줄의 사업자 구분과 판매가를 입력해주세요.'), skipped: skippedLines, notFound };
    }

    // 공급자 정보와 직인
    const sellerIds = [...new Set(groups.map((g) => g.sellerId))];
    const { data: sellerRows, error: sellerError } = await supabase
      .from('seller_businesses')
      .select('id, name, registration_no, representative_name, address, business_type, business_item, seal_image')
      .in('id', sellerIds);
    if (sellerError) throw new Error(sellerError.message);
    const sellers = new Map<string, ReceiptSeller>();
    const seals: Record<string, string | null> = {};
    for (const s of sellerRows ?? []) {
      sellers.set(s.id, { name: s.name, registrationNo: s.registration_no, representative: s.representative_name, address: s.address, businessType: s.business_type, businessItem: s.business_item });
      seals[s.id] = s.seal_image;
    }
    const issuable = groups.filter((g) => sellers.has(g.sellerId));
    if (issuable.length === 0) return { ...fail('사업자를 찾지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.'), skipped: skippedLines, notFound };

    // 영수증 번호(NO.): 같은 출고일 안에서 이미 발행한 번호 다음부터 붙인다.
    const dates = [...new Set(issuable.map((g) => g.orderDate))];
    const { data: existing, error: numberError } = await supabase.from('settlement_receipts').select('order_date, receipt_no').in('order_date', dates);
    if (numberError) throw new Error(numberError.message);
    const lastNo = new Map<string, number>();
    for (const r of existing ?? []) lastNo.set(r.order_date, Math.max(lastNo.get(r.order_date) ?? 0, r.receipt_no));

    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub ?? null;
    const prepared = issuable.map((g) => {
      const receiptNo = (lastNo.get(g.orderDate) ?? 0) + 1;
      lastNo.set(g.orderDate, receiptNo);
      const snapshot = buildSnapshot(g, sellers.get(g.sellerId)!);
      return { receiptNo, snapshot, sellerId: g.sellerId };
    });
    const { data: inserted, error: insertError } = await supabase
      .from('settlement_receipts')
      .insert(
        prepared.map((p) => ({
          receipt_no: p.receiptNo,
          order_date: p.snapshot.orderDate,
          customer_name: p.snapshot.customerName.slice(0, 60),
          seller_id: p.sellerId,
          total: p.snapshot.total,
          snapshot: p.snapshot,
          created_by: userId,
        })),
      )
      .select('id, order_date, receipt_no');
    if (insertError) throw new Error(insertError.message);
    const idByKey = new Map((inserted ?? []).map((r) => [`${r.order_date}|${r.receipt_no}`, r.id]));
    const receipts: IssuedReceipt[] = prepared.map((p) => ({
      id: idByKey.get(`${p.snapshot.orderDate}|${p.receiptNo}`) ?? '',
      receiptNo: p.receiptNo,
      sellerId: p.sellerId,
      snapshot: p.snapshot,
    }));
    revalidatePath('/settlement');
    revalidatePath('/receipts');
    return { error: null, receipts, seals, skipped: skippedLines, notFound };
  } catch (e) {
    // 운영 환경은 서버 오류 문구를 가리므로, 원인을 알 수 있는 경우는 결과로 돌려준다.
    if (missingTable(e) !== null) return fail(`마이그레이션 ${migrationsFor(['settlement_receipts']).join(', ')}을 먼저 적용해주세요.`);
    throw e;
  }
}

// 발행 이력에서 영수증 한 건을 지운다(이미 내려받거나 보낸 이미지는 그대로다). 잘못 발행한 영수증이나 시험 발행을 정리할 때 쓴다.
export async function deleteReceipt(id: string): Promise<{ error: string | null }> {
  await requirePermission('receipts:delete');
  const supabase = await createClient();
  const { data, error } = await supabase.from('settlement_receipts').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: '이미 삭제되었거나 찾을 수 없는 영수증입니다.' };
  revalidatePath('/settlement'); // 정산 화면의 "이미 발행됨" 경고도 새로 읽는다
  revalidatePath('/receipts');
  revalidatePath('/dispatch'); // 보내기 화면(고객사 탭)의 영수증 개수·미리보기도 새로 읽는다
  return { error: null };
}

// 이력에서 영수증을 다시 열 때 쓰는 직인 이미지. 용량이 커서 이력 목록과 따로, 열 때만 읽는다.
export async function loadReceiptSeal(sellerId: string): Promise<{ error: string | null; seal: string | null }> {
  await requirePermission('receipts:view');
  const supabase = await createClient();
  const { data, error } = await supabase.from('seller_businesses').select('seal_image').eq('id', sellerId).maybeSingle();
  if (error) return { error: error.message, seal: null };
  return { error: null, seal: data?.seal_image ?? null };
}
