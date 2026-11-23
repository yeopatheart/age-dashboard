'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateBusiness, findOrCreateDailyBusiness } from '@/lib/business-lookup';
import type { ChangeStatus, OrderRound, Prep } from '@/lib/orders';
import { requirePermission } from '@/lib/permissions/access';
import { editableDateError, todayKST } from '@/lib/order-date';
import { manualItemChanged, resolveManualChangeStatus } from '@/lib/manual-item-status';
import { loadAppSettings } from '@/lib/settings-server';
import { inkCutoffTime, parseInkStrokes } from '@/lib/ink/store';
import { missingTable, migrationsFor } from '@/lib/supabase/missing-table';
import { parseBoardEnv } from '@/lib/board-env';
import { isIsoDate, nonNegativeNumberError, positiveNumberError, textError } from '@/lib/validate';
import { stickerQuantityError, stickerScopeOf } from '@/lib/stickers';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { loadSubmittedBoxCounts } from '@/lib/scan-boxes';
import type { OrderDeleteImpact } from '@/lib/order-delete-warning';
import type { Database } from '@/lib/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

type Supabase = SupabaseClient<Database>;

// 화면의 readOnly(과거 날짜 + 설정 꺼짐)와 같은 규칙을 서버에서도 강제한다. 오늘이면 설정을 읽지 않는다.
async function dateError(supabase: Supabase, orderDate: string): Promise<string | null> {
  if (orderDate === todayKST()) return null;
  return editableDateError(orderDate, (await loadAppSettings(supabase)).allowPastOrderEdit);
}

async function dailyDateError(supabase: Supabase, dailyBusinessId: string): Promise<string | null> {
  const { data } = await supabase.from('daily_businesses').select('order_date').eq('id', dailyBusinessId).maybeSingle();
  if (!data) return '주문을 찾지 못했습니다.';
  return dateError(supabase, data.order_date);
}

async function itemDateError(supabase: Supabase, orderItemId: string): Promise<string | null> {
  const { data } = await supabase.from('order_items').select('daily_business_id').eq('id', orderItemId).maybeSingle();
  if (!data) return '상품을 찾지 못했습니다.';
  return dailyDateError(supabase, data.daily_business_id);
}

export async function togglePacked(orderItemId: string, nextPacked: boolean): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const guard = await itemDateError(supabase, orderItemId);
  if (guard) return { error: guard };
  const { error } = await supabase
    .from('order_items')
    .update({ is_packed: nextPacked, packed_at: nextPacked ? new Date().toISOString() : null })
    .eq('id', orderItemId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}

// 칠판 펜 그림을 날짜·모니터당 한 행에 통째로 저장한다(PC가 같은 그림을 본다). 칠판이 그릴 때마다 최신 전체를 보내므로 마지막 저장이 남는다.
// 획은 서버에서도 한 번 더 걸러 저장한다. 보관은 마지막 저장 뒤 3일이라, 저장할 때 그보다 오래 손대지 않은 행을 지운다. 이 화면은 새로 그리지 않으므로 revalidatePath는 부르지 않는다.
export async function saveBoardInk(orderDate: string, monitor: string, strokes: unknown): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  if (!isIsoDate(orderDate)) return { error: '날짜 형식이 올바르지 않습니다.' };
  if (!/^(1|2|s[1-9]?)$/.test(monitor)) return { error: '모니터는 1·2 또는 별도 주문 팝업의 쪽(s1~s9)입니다.' };
  const supabase = await createClient();
  const guard = await dateError(supabase, orderDate);
  if (guard) return { error: guard };
  const { error } = await supabase
    .from('board_ink')
    .upsert({ order_date: orderDate, monitor, strokes: parseInkStrokes(strokes), updated_at: new Date().toISOString() }, { onConflict: 'order_date,monitor' });
  if (error) {
    const table = missingTable(error.message);
    if (table) return { error: `펜 그림 저장 테이블이 없습니다. 마이그레이션 ${migrationsFor([table]).join(', ')}을 먼저 적용해 주세요.` };
    if (/board_ink_monitor_check/.test(error.message)) return { error: '별도 주문 팝업 그림 저장 설정이 없습니다. 마이그레이션 0059_board_ink_separate_pages.sql을 먼저 적용해 주세요.' };
    return { error: error.message };
  }
  // 오래된 그림 정리는 저장을 막지 않는다(실패해도 다음 저장 때 다시 시도한다).
  // 기준은 주문 날짜가 아니라 마지막 저장 시각이다(과거 날짜 화면에서 방금 그린 그림을 지우면 안 된다).
  await supabase.from('board_ink').delete().lt('updated_at', inkCutoffTime(new Date()));
  return { error: null };
}

// "새 주문 추가" 창의 고객사 검색 목록. 주문 목록 페이지는 실시간 변경마다 다시 읽히므로 전체 목록을 거기에 싣지 않고, 창을 열 때만 받는다.
export async function loadBusinessDirectory(): Promise<{ error: string | null; businesses: { id: string; name: string; terminal_id: string | null }[] }> {
  await requirePermission('dashboard:view');
  const supabase = await createClient();
  try {
    const businesses = await fetchAll((from, to) => supabase.from('businesses').select('id, name, terminal_id').order('name').order('id').range(from, to), '업체 조회 실패: ');
    return { error: null, businesses };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '업체 목록을 불러오지 못했습니다.', businesses: [] };
  }
}

// ── 매트릭스 대시보드의 수동 편집 액션 ──────────────────────────────────────────

export async function createManualOrder(
  orderDate: string,
  round: OrderRound,
  businessName: string,
  terminalId: string | null,
): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  if (!isIsoDate(orderDate)) return { error: '날짜 형식이 올바르지 않습니다.' };
  const nameInvalid = textError(businessName, '업체명', 60);
  if (nameInvalid) return { error: nameInvalid };
  const supabase = await createClient();
  const guard = await dateError(supabase, orderDate);
  if (guard) return { error: guard };
  const businessId = await findOrCreateBusiness(supabase, businessName, terminalId);
  if (!businessId) return { error: '업체를 생성하지 못했습니다.' };

  const dailyBusinessId = await findOrCreateDailyBusiness(supabase, orderDate, businessId, round, terminalId);
  if (!dailyBusinessId) return { error: '오늘자 주문 카드를 생성하지 못했습니다.' };

  revalidatePath('/dashboard');
  return { error: null };
}

// 드래그로 바꾼 표시 순서를 저장한다. orderedIds는 그 날짜 카드 전체를 새 순서대로 담아야 한다.
export async function reorderDailyBusinesses(orderedIds: string[]): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('reorder_daily_businesses', { p_ids: orderedIds });
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  return { error: error?.message ?? null };
}

// 고객사 간 합포장 연결(0072): 서로 다른 두 고객의 각 1박스를 한 박스로 내보낸다. 조건(같은 터미널·박스 1개·미상차 등)은 DB 함수가 확인하고 위반 사유를 메시지로 돌려준다.
export async function linkBoxPair(aId: string, bId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const guard = (await dailyDateError(supabase, aId)) ?? (await dailyDateError(supabase, bId));
  if (guard) return { error: guard };
  const { error } = await supabase.rpc('link_box_pair', { p_a: aId, p_b: bId });
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/scan');
  return { error: null };
}

// 합포장 연결 해제: 어느 쪽 고객을 넘겨도 두 카드가 함께 풀린다.
export async function unlinkBoxPair(dailyBusinessId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const guard = await dailyDateError(supabase, dailyBusinessId);
  if (guard) return { error: guard };
  const { error } = await supabase.rpc('unlink_box_pair', { p_id: dailyBusinessId });
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/scan');
  return { error: null };
}

// 업체명은 businesses 테이블 소속이라 바꾸면 다른 날짜의 과거 기록 표시에도 영향을 준다.
// 터미널은 그날 카드(daily_businesses)의 값이라 이 주문만 바뀌고, 업체의 기본 터미널과 다른 날짜는 그대로다.
// 같은 날·차수·업체에 이미 그 터미널의 카드가 있으면 합칠 수 없어 오류를 돌려준다.
// 별도 주문 팝업에서 그날 카드의 고객명만 바꾼다(display_name). 고객사 이름(businesses.name)과 다른 날짜의 카드는 그대로다.
// 비우거나 고객사 이름과 같게 쓰면 기본 이름으로 돌아간다.
export async function renameDailyBusiness(dailyBusinessId: string, name: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const trimmed = name.trim();
  if (trimmed.length > 60) return { error: '고객명은 60자까지 입력할 수 있습니다.' };
  const supabase = await createClient();
  const guard = await dailyDateError(supabase, dailyBusinessId);
  if (guard) return { error: guard };
  const { data: daily } = await supabase.from('daily_businesses').select('business_id').eq('id', dailyBusinessId).maybeSingle();
  if (!daily) return { error: '주문을 찾지 못했습니다.' };
  const { data: business } = await supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle();
  const displayName = trimmed && trimmed !== business?.name ? trimmed : null;
  const { error } = await supabase.from('daily_businesses').update({ display_name: displayName }).eq('id', dailyBusinessId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  revalidatePath('/scan');
  return { error: null };
}

// 주문 수정은 터미널만 바꾼다. 고객명은 바꿀 수 없다 — 업체 마스터의 이름이 바뀌어 다른 날짜·1·2차 카드와 다음 날 주문 매칭에 영향을 준다(고객사 관리에서 바꾼다).
export async function updateOrder(dailyBusinessId: string, terminalId: string | null): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const guard = await dailyDateError(supabase, dailyBusinessId);
  if (guard) return { error: guard };
  const { error: terminalError } = await supabase.from('daily_businesses').update({ terminal_id: terminalId }).eq('id', dailyBusinessId);
  if (terminalError) {
    return { error: terminalError.code === '23505' ? '같은 차수에 이 터미널의 같은 업체 주문이 이미 있습니다.' : terminalError.message };
  }
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  return { error: null };
}

// 주문 삭제 확인창에 보여 줄 "함께 지워지는 기록": 제출한 박스 수, 발급된 라벨 수, 그중 상차 완료 수. 읽기만 한다.
export async function getOrderDeleteImpact(dailyBusinessId: string): Promise<{ impact: OrderDeleteImpact | null; error: string | null }> {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  try {
    const [boxCounts, { data: labels, error }] = await Promise.all([
      loadSubmittedBoxCounts(supabase, [dailyBusinessId]),
      supabase.from('box_labels').select('loaded_at').eq('daily_business_id', dailyBusinessId),
    ]);
    if (error) return { impact: null, error: error.message };
    return {
      impact: { submittedBoxes: boxCounts.get(dailyBusinessId) ?? 0, labels: (labels ?? []).length, loadedLabels: (labels ?? []).filter((l) => l.loaded_at).length },
      error: null,
    };
  } catch (e) {
    return { impact: null, error: e instanceof Error ? e.message : '박스·라벨 기록을 확인하지 못했습니다.' };
  }
}

// order_items는 daily_businesses에 on delete cascade로 걸려있어(0003) 함께 삭제된다.
export async function deleteDailyBusiness(dailyBusinessId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  const guard = await dailyDateError(supabase, dailyBusinessId);
  if (guard) return { error: guard };
  const { error } = await supabase.from('daily_businesses').delete().eq('id', dailyBusinessId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}

export interface ManualItemFields {
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  changeStatus: ChangeStatus;
  // 포장 방식: 일반 / 물봉 / 기포기(물봉 + 기포기 부착)
  prep: Prep;
}

// 수량을 비워 저장하는 "수량 미정"(수량 0, 단위 없음, isUndecidedQuantity)은 정상 입력이라 수량·단위 검사를 건너뛴다.
function manualItemError(fields: ManualItemFields): string | null {
  const undecided = fields.quantity === 0 && fields.unit === '';
  return (
    textError(fields.productName, '상품명', 100) ??
    (undecided ? null : textError(fields.unit, '단위', 10) ?? positiveNumberError(fields.quantity, '수량')) ??
    (fields.secondaryWeightKg === null ? null : nonNegativeNumberError(fields.secondaryWeightKg, '무게')) ??
    (fields.sizeRequest !== null && fields.sizeRequest.length > 100 ? '사이즈 요청은 100자까지 입력할 수 있습니다.' : null)
  );
}

export async function addOrderItemManual(dailyBusinessId: string, fields: ManualItemFields): Promise<{ error: string | null }> {
  const access = await requirePermission('dashboard:edit');
  const invalid = manualItemError(fields);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const guard = await dailyDateError(supabase, dailyBusinessId);
  if (guard) return { error: guard };
  const userId = access.userId;

  const { data: sequence, error: sequenceError } = await supabase.rpc('assign_product_sequence', {
    p_daily_business_id: dailyBusinessId,
  });
  if (sequenceError) return { error: sequenceError.message };

  const { error } = await supabase.from('order_items').insert({
    daily_business_id: dailyBusinessId,
    product_sequence: sequence ?? 0,
    product_name_raw: fields.productName,
    quantity: fields.quantity,
    unit: fields.unit,
    secondary_weight_kg: fields.secondaryWeightKg,
    size_request: fields.sizeRequest,
    is_mulbong: fields.prep !== 'none',
    has_aerator: fields.prep === 'aerator',
    change_status: fields.changeStatus,
    created_by: userId,
  });
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}

export async function updateOrderItemManual(orderItemId: string, fields: ManualItemFields): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const invalid = manualItemError(fields);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const guard = await itemDateError(supabase, orderItemId);
  if (guard) return { error: guard };
  const { data: current } = await supabase
    .from('order_items')
    .select('product_name_raw, quantity, unit, secondary_weight_kg, size_request, is_mulbong, has_aerator, change_status')
    .eq('id', orderItemId)
    .maybeSingle();
  if (!current) return { error: '상품을 찾지 못했습니다.' };
  // 일반 상품의 내용을 고쳤는데 상태가 그대로면 칠판에서 수정 여부를 알 수 없다: 이때만 수정됨으로 올린다.
  const changeStatus = resolveManualChangeStatus(
    current.change_status,
    fields.changeStatus,
    manualItemChanged(
      {
        productName: current.product_name_raw,
        quantity: Number(current.quantity),
        unit: current.unit,
        secondaryWeightKg: current.secondary_weight_kg === null ? null : Number(current.secondary_weight_kg),
        sizeRequest: current.size_request,
        isMulbong: current.is_mulbong,
        hasAerator: current.has_aerator,
      },
      {
        productName: fields.productName,
        quantity: fields.quantity,
        unit: fields.unit,
        secondaryWeightKg: fields.secondaryWeightKg,
        sizeRequest: fields.sizeRequest,
        isMulbong: fields.prep !== 'none',
        hasAerator: fields.prep === 'aerator',
      },
    ),
  );
  const { error } = await supabase
    .from('order_items')
    .update({
      product_name_raw: fields.productName,
      quantity: fields.quantity,
      unit: fields.unit,
      secondary_weight_kg: fields.secondaryWeightKg,
      size_request: fields.sizeRequest,
      is_mulbong: fields.prep !== 'none',
      has_aerator: fields.prep === 'aerator',
      change_status: changeStatus,
    })
    .eq('id', orderItemId);
  if (error) return { error: error.message };
  // 주문 수량을 미출고 수량보다 줄이면 미출고 수량도 주문 수량에 맞춘다.
  const { error: unshippedError } = await supabase.from('order_items').update({ unshipped_quantity: fields.quantity }).eq('id', orderItemId).gt('unshipped_quantity', fields.quantity);
  if (unshippedError) return { error: unshippedError.message };
  revalidatePath('/dashboard');
  return { error: null };
}

// 미출고: 주문은 유효하지만 현장에서 출고하지 못한 수량과 사유를 기록한다(취소와 별개). 0이면 해제.
export async function setItemUnshipped(orderItemId: string, quantity: number, reason: string | null): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: item } = await supabase.from('order_items').select('quantity').eq('id', orderItemId).maybeSingle();
  if (!item) return { error: '상품을 찾지 못했습니다.' };
  const max = Number(item.quantity);
  if (!(quantity >= 0) || quantity > max + 0.0001) return { error: `미출고 수량은 0~${max} 사이여야 합니다.` };
  const { error } = await supabase
    .from('order_items')
    .update({ unshipped_quantity: quantity, unshipped_reason: quantity > 0 ? (reason?.trim() || null) : null })
    .eq('id', orderItemId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  revalidatePath('/packing-log');
  return { error: null };
}

export async function cancelOrderItem(orderItemId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  const guard = await itemDateError(supabase, orderItemId);
  if (guard) return { error: guard };
  const { error } = await supabase.from('order_items').update({ change_status: 'cancelled' }).eq('id', orderItemId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}

// 방금 취소한 상품을 되살린다(취소 직후의 "되돌리기"). 취소 상태인 줄만 바꾸고, 취소하기 전 상태(new/modified/none)로 돌려놓는다.
export async function restoreOrderItem(orderItemId: string, previousStatus: 'new' | 'modified' | 'none'): Promise<{ error: string | null }> {
  await requirePermission('dashboard:delete');
  if (!['new', 'modified', 'none'].includes(previousStatus)) return { error: '되돌릴 상태가 올바르지 않습니다.' };
  const supabase = await createClient();
  const guard = await itemDateError(supabase, orderItemId);
  if (guard) return { error: guard };
  const { data, error } = await supabase.from('order_items').update({ change_status: previousStatus }).eq('id', orderItemId).eq('change_status', 'cancelled').select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: '이미 취소 상태가 아니라서 되돌릴 것이 없습니다.' };
  revalidatePath('/dashboard');
  return { error: null };
}

export async function deleteOrderItem(orderItemId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:delete');
  const supabase = await createClient();
  const guard = await itemDateError(supabase, orderItemId);
  if (guard) return { error: guard };
  const { error } = await supabase.from('order_items').delete().eq('id', orderItemId);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}

// 대시보드 주문표에서 상품명을 강조할 상품을 날짜별로 켜고 끈다. 보기 설정이라 과거 날짜 편집 설정과 무관하게 항상 쓸 수 있다.
// 켤 때는 그날 이미 고른 개수 다음 순서를 준다(색은 이 순서로 다르게 나눠 준다).
export async function setProductHighlight(orderDate: string, productName: string, on: boolean): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  if (!on) {
    const { error } = await supabase.from('daily_product_highlights').delete().eq('order_date', orderDate).eq('product_name', productName);
    if (error) return { error: error.message };
  } else {
    const { data: last } = await supabase
      .from('daily_product_highlights')
      .select('position')
      .eq('order_date', orderDate)
      .order('position', { ascending: false })
      .limit(1);
    const { error } = await supabase
      .from('daily_product_highlights')
      .upsert({ order_date: orderDate, product_name: productName, position: (last?.[0]?.position ?? -1) + 1 }, { onConflict: 'order_date,product_name' });
    if (error) return { error: error.message };
  }
  revalidatePath('/dashboard');
  return { error: null };
}

export async function clearProductHighlights(orderDate: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { error } = await supabase.from('daily_product_highlights').delete().eq('order_date', orderDate);
  if (error) return { error: error.message };
  revalidatePath('/dashboard');
  return { error: null };
}

// 칠판이 펜으로 쓸 수 있는 기기로 판정됐는지(아니면 왜 막혔는지)를 서버 로그에 한 줄 남긴다. Vercel Logs에서 `board-env`로 찾는다.
// 값은 믿지 않고 모양·길이를 확인한 뒤 남긴다(src/lib/board-env.ts). 개인정보는 없다. DB에는 아무것도 쓰지 않는다.
export async function reportBoardEnv(value: unknown): Promise<void> {
  await requirePermission('dashboard:view');
  const report = parseBoardEnv(value);
  if (!report) return;
  console.log('[board-env]', JSON.stringify({ sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7), ...report }));
}

// ── 상품 칸 스티커(0075). 결정: docs/decisions/2026-11-22-stickers.md ─────────────────────────────────────────────
// 붙이는 규칙(한 칸에 최대 2개, 같은 이름은 한 번만, 수량은 정수)은 DB의 unique·트리거가 마지막으로 막고, 여기서는 사람이 읽을 안내로 바꾼다.
// 권한·날짜는 포장 체크(togglePacked)와 같다: 수정 권한이 있어야 하고, 과거 날짜는 설정이 켜져 있어야 한다.

function stickerWriteError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return '이 상품에는 같은 스티커가 이미 붙어 있습니다.';
  if (/business card can hold at most 2 stickers/.test(error.message)) return '한 고객사에는 스티커를 2개까지 붙일 수 있습니다.';
  if (error.code === '23514' || /at most 2 stickers/.test(error.message)) return '한 칸에는 스티커를 2개까지 붙일 수 있습니다.';
  const table = missingTable(error.message);
  if (table) return `스티커 테이블이 없습니다. 마이그레이션 ${migrationsFor([table]).join(', ') || '0075_order_item_stickers.sql'}을 먼저 적용해 주세요.`;
  return error.message;
}

// 스티커를 붙인다. 스티커 목록(sticker_presets)에서 붙을 당시의 이름·색을 복사해 두므로, 목록을 나중에 고치거나 지워도 그날의 칠판은 그대로다.
export async function addItemSticker(orderItemId: string, presetId: string, quantity: number | null): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const guard = await itemDateError(supabase, orderItemId);
  if (guard) return { error: guard };
  const { data: preset, error: presetError } = await supabase.from('sticker_presets').select('id, label, fill_color, border_color, uses_quantity, scope').eq('id', presetId).maybeSingle();
  if (presetError) return { error: stickerWriteError(presetError) };
  if (!preset) return { error: '스티커를 찾지 못했습니다. 스티커 목록이 바뀌었을 수 있으니 화면을 새로 열어 주세요.' };
  if (stickerScopeOf(preset.scope) === 'business') return { error: '이 스티커는 고객명 칸에 붙입니다.' };
  const quantityProblem = stickerQuantityError(preset.uses_quantity, quantity);
  if (quantityProblem) return { error: quantityProblem };
  const { data: item } = await supabase.from('order_items').select('daily_business_id').eq('id', orderItemId).maybeSingle();
  if (!item) return { error: '상품을 찾지 못했습니다.' };
  const { error } = await supabase.from('order_item_stickers').insert({
    order_item_id: orderItemId,
    daily_business_id: item.daily_business_id,
    preset_id: preset.id,
    label: preset.label,
    fill_color: preset.fill_color,
    border_color: preset.border_color,
    quantity,
  });
  if (error) return { error: stickerWriteError(error) };
  revalidatePath('/dashboard');
  return { error: null };
}

// 이미 붙은 스티커(수량을 쓰는 것)의 수량을 바꾼다. 수량을 쓰지 않는 스티커(붙일 때 수량이 없던 것)는 바꿀 수 없다.
export async function setItemStickerQuantity(stickerId: string, quantity: number): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: sticker, error: readError } = await supabase.from('order_item_stickers').select('order_item_id, quantity').eq('id', stickerId).maybeSingle();
  if (readError) return { error: stickerWriteError(readError) };
  if (!sticker) return { error: '스티커를 찾지 못했습니다. 이미 떼어졌을 수 있습니다.' };
  if (sticker.quantity === null) return { error: '이 스티커는 수량을 쓰지 않습니다.' };
  const guard = await itemDateError(supabase, sticker.order_item_id);
  if (guard) return { error: guard };
  const quantityProblem = stickerQuantityError(true, quantity);
  if (quantityProblem) return { error: quantityProblem };
  const { error } = await supabase.from('order_item_stickers').update({ quantity }).eq('id', stickerId);
  if (error) return { error: stickerWriteError(error) };
  revalidatePath('/dashboard');
  return { error: null };
}

export async function removeItemSticker(stickerId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: sticker, error: readError } = await supabase.from('order_item_stickers').select('order_item_id').eq('id', stickerId).maybeSingle();
  if (readError) return { error: stickerWriteError(readError) };
  if (!sticker) return { error: null }; // 이미 떼어졌다(다른 기기에서) — 같은 결과이므로 오류로 보이지 않는다
  const guard = await itemDateError(supabase, sticker.order_item_id);
  if (guard) return { error: guard };
  const { error } = await supabase.from('order_item_stickers').delete().eq('id', stickerId);
  if (error) return { error: stickerWriteError(error) };
  revalidatePath('/dashboard');
  return { error: null };
}

// ── 고객사 스티커(0076). 결정: docs/decisions/2026-11-23-business-stickers.md ─────────────────────────────────────
// 고객사 카드(고객명 칸)에 붙는 스티커. 상품 칸 스티커와 같은 권한·날짜 규칙이고 수량이 없다.
export async function addBusinessSticker(dailyBusinessId: string, presetId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const guard = await dailyDateError(supabase, dailyBusinessId);
  if (guard) return { error: guard };
  const { data: preset, error: presetError } = await supabase.from('sticker_presets').select('id, label, fill_color, border_color, scope').eq('id', presetId).maybeSingle();
  if (presetError) return { error: stickerWriteError(presetError) };
  if (!preset) return { error: '스티커를 찾지 못했습니다. 스티커 목록이 바뀌었을 수 있으니 화면을 새로 열어 주세요.' };
  if (stickerScopeOf(preset.scope) !== 'business') return { error: '이 스티커는 상품 칸에 붙입니다.' };
  const { error } = await supabase.from('business_stickers').insert({
    daily_business_id: dailyBusinessId,
    preset_id: preset.id,
    label: preset.label,
    fill_color: preset.fill_color,
    border_color: preset.border_color,
  });
  if (error) return { error: error.code === '23505' ? '이 고객사에는 같은 스티커가 이미 붙어 있습니다.' : stickerWriteError(error) };
  revalidatePath('/dashboard');
  return { error: null };
}

export async function removeBusinessSticker(stickerId: string): Promise<{ error: string | null }> {
  await requirePermission('dashboard:edit');
  const supabase = await createClient();
  const { data: sticker, error: readError } = await supabase.from('business_stickers').select('daily_business_id').eq('id', stickerId).maybeSingle();
  if (readError) return { error: stickerWriteError(readError) };
  if (!sticker) return { error: null }; // 이미 떼어졌다(다른 기기에서)
  const guard = await dailyDateError(supabase, sticker.daily_business_id);
  if (guard) return { error: guard };
  const { error } = await supabase.from('business_stickers').delete().eq('id', stickerId);
  if (error) return { error: stickerWriteError(error) };
  revalidatePath('/dashboard');
  return { error: null };
}
