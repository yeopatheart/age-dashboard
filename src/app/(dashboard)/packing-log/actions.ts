'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { editableDateError } from '@/lib/order-date';
import { assignToBoxes, trainModel, type PackingItem } from '@/lib/packing/model';
import { compareWithRecommendation, getTodayModel, orderSignature } from '@/lib/packing/server';

export interface PackingSubmission {
  dailyBusinessId: string;
  boxes: { boxId: string; items: { orderItemId: string; quantity: number }[] }[];
  // 선택 입력: 상품별 실측 중량(kg). 값이 없으면(null) 건드리지 않는다.
  weights: Record<string, number | null>;
  // 상품 배치를 사람이 직접 확인했는지(상세 수정). 박스가 1개면 배치가 자명하므로 항상 확인된 것으로 저장한다.
  itemsVerified: boolean;
}

const EPSILON = 0.0001;

// 박스 기록 제출. 화면에서 작성하는 동안에는 아무것도 저장하지 않고, 제출할 때 업체·일자 단위로 한 번에
// 저장한다(이미 제출한 업체를 다시 제출하면 이전 기록을 대체한다). 박스·상품 정보는 이 시점 값을 복사해서
// 남긴다 — 박스 추천 모델의 학습 데이터라서 나중에 주문이나 박스 정보가 바뀌어도 변하면 안 된다.
export async function submitPacking(input: PackingSubmission): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? null;

  if (input.boxes.length === 0) return { error: '박스를 하나 이상 추가해주세요.' };

  const { data: daily } = await supabase
    .from('daily_businesses')
    .select('id, order_date, business_id, terminal_id')
    .eq('id', input.dailyBusinessId)
    .maybeSingle();
  if (!daily) return { error: '업체 주문을 찾지 못했습니다.' };
  const dateError = editableDateError(daily.order_date, (await loadAppSettings(supabase)).allowPastOrderEdit);
  if (dateError) return { error: dateError };

  const [{ data: business }, { data: items }, { data: boxRows }] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle(),
    supabase
      .from('order_items')
      .select('id, product_name_raw, unit, quantity, secondary_weight_kg, size_request, is_mulbong, change_status, unshipped_quantity')
      .eq('daily_business_id', daily.id),
    supabase
      .from('boxes')
      .select('id, name, inner_width_cm, inner_depth_cm, inner_height_cm, is_mulbong_box')
      .in('id', [...new Set(input.boxes.map((b) => b.boxId))]),
  ]);

  // 담아야 할 수량 = 주문 − 미출고. 전량 미출고인 상품은 대상에서 뺀다.
  const liveItems = (items ?? [])
    .filter((i) => i.change_status !== 'cancelled')
    .map((i) => ({ ...i, quantity: Number(i.quantity) - Number(i.unshipped_quantity ?? 0) }))
    .filter((i) => i.quantity > EPSILON);
  const itemById = new Map(liveItems.map((i) => [i.id, i]));
  const boxById = new Map((boxRows ?? []).map((b) => [b.id, b]));

  // 모든 상품이 빠짐없이, 수량이 정확히 맞게 담겼는지 서버에서도 다시 확인한다.
  const placed = new Map<string, number>();
  for (const box of input.boxes) {
    if (!boxById.has(box.boxId)) return { error: '존재하지 않는 박스가 포함돼 있습니다.' };
    for (const it of box.items) {
      if (!itemById.has(it.orderItemId)) return { error: '이 업체의 주문에 없는 상품이 포함돼 있습니다.' };
      if (!(it.quantity > 0)) return { error: '담은 수량은 0보다 커야 합니다.' };
      placed.set(it.orderItemId, (placed.get(it.orderItemId) ?? 0) + it.quantity);
    }
  }
  for (const item of liveItems) {
    if (Math.abs((placed.get(item.id) ?? 0) - Number(item.quantity)) > EPSILON) {
      return { error: `'${item.product_name_raw}'의 수량이 주문과 맞지 않습니다. 모든 상품을 빠짐없이 담아주세요.` };
    }
  }

  const [{ data: terminal }, { data: products }] = await Promise.all([
    // 그날 카드의 터미널(고객사 기본 터미널과 다를 수 있다)
    daily.terminal_id ? supabase.from('terminals').select('name').eq('id', daily.terminal_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('products').select('name, needs_mulbong').in('name', [...new Set(liveItems.map((i) => i.product_name_raw))]),
  ]);
  const needsMulbong = new Map((products ?? []).map((p) => [p.name, p.needs_mulbong]));

  // 박스 추천 shadow test: 제출 시점의 주문 내용에 대한 추천과 현장 결과를 비교해 함께 남긴다.
  const signature = orderSignature(
    liveItems.map((i) => ({
      id: i.id,
      name: i.product_name_raw,
      unit: i.unit,
      quantity: i.quantity,
      mulbongFlag: i.is_mulbong || (needsMulbong.get(i.product_name_raw) ?? false),
    })),
  );
  const comparison = await compareWithRecommendation(
    supabase,
    daily.id,
    signature,
    input.boxes.map((box) => ({
      boxId: box.boxId,
      boxName: boxById.get(box.boxId)!.name,
      isMulbongBox: boxById.get(box.boxId)!.is_mulbong_box,
      items: box.items.map((it) => ({ orderItemId: it.orderItemId, quantity: it.quantity })),
    })),
  );

  // 이전 제출 기록은 지우고 새로 만든다(하위 박스·상품은 cascade로 함께 삭제).
  await supabase.from('packing_records').delete().eq('daily_business_id', daily.id);

  const { data: record, error: recordError } = await supabase
    .from('packing_records')
    .insert({
      daily_business_id: daily.id,
      order_date: daily.order_date,
      business_name: business?.name ?? '',
      terminal_name: terminal?.name ?? null,
      submitted_by: userId,
      order_signature: signature,
      items_verified: input.boxes.length === 1 || input.itemsVerified,
      ...comparison,
    })
    .select('id')
    .single();
  if (recordError || !record) return { error: recordError?.message ?? '박스 할당을 저장하지 못했습니다.' };

  const rollback = async (message: string) => {
    await supabase.from('packing_records').delete().eq('id', record.id);
    return { error: message };
  };

  const { data: createdBoxes, error: boxError } = await supabase
    .from('packing_boxes')
    .insert(
      input.boxes.map((box, position) => {
        const b = boxById.get(box.boxId)!;
        return {
          record_id: record.id,
          box_id: b.id,
          position,
          box_name: b.name,
          inner_width_cm: b.inner_width_cm,
          inner_depth_cm: b.inner_depth_cm,
          inner_height_cm: b.inner_height_cm,
          is_mulbong_box: b.is_mulbong_box,
        };
      }),
    )
    .select('id, position');
  if (boxError || !createdBoxes) return rollback(boxError?.message ?? '박스를 저장하지 못했습니다.');
  const boxIdByPosition = new Map(createdBoxes.map((b) => [b.position, b.id]));

  const itemRows = input.boxes.flatMap((box, position) =>
    box.items.map((it) => {
      const item = itemById.get(it.orderItemId)!;
      return {
        packing_box_id: boxIdByPosition.get(position)!,
        order_item_id: item.id,
        product_name: item.product_name_raw,
        unit: item.unit,
        quantity: it.quantity,
        secondary_weight_kg: item.secondary_weight_kg,
        size_request: item.size_request,
        is_mulbong: item.is_mulbong,
        needs_mulbong: needsMulbong.get(item.product_name_raw) ?? false,
      };
    }),
  );
  const { error: itemError } = await supabase.from('packing_box_items').insert(itemRows);
  if (itemError) return rollback(itemError.message);

  // 실측 중량(선택 입력)
  const weightUpdates = Object.entries(input.weights)
    .filter(([id]) => itemById.has(id))
    .map(([id, kg]) => supabase.from('order_items').update({ measured_weight_kg: kg }).eq('id', id));
  await Promise.all(weightUpdates);

  // 리포트 집계(report_summary)가 daily_businesses.total_boxes를 합산하므로 제출한 박스 수를 맞춰 둔다.
  await supabase.from('daily_businesses').update({ total_boxes: input.boxes.length }).eq('id', daily.id);

  revalidatePath('/packing-log');
  revalidatePath('/dashboard');
  return { error: null };
}

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// 수정 중인 박스 구성(박스 종류 목록)에 상품을 모델 규칙으로 자동으로 나눠 담은 결과를 돌려준다. 저장은 하지 않는다.
// 반환 순서는 입력 boxIds 순서와 같다.
export async function assignItemsToBoxes(input: {
  dailyBusinessId: string;
  boxIds: string[];
}): Promise<{ error: string | null; boxes: { items: { orderItemId: string; quantity: number }[] }[] }> {
  const fail = (error: string) => ({ error, boxes: [] });
  if (input.boxIds.length === 0 || input.boxIds.length > 60) return fail('박스 개수가 올바르지 않습니다.');

  const supabase = await createClient();
  const [{ data: items }, { data: boxRows }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, product_name_raw, unit, quantity, is_mulbong, change_status, unshipped_quantity')
      .eq('daily_business_id', input.dailyBusinessId),
    supabase.from('boxes').select('id, name, is_mulbong_box').in('id', [...new Set(input.boxIds)]),
  ]);
  const boxById = new Map((boxRows ?? []).map((b) => [b.id, b]));
  const chosen = input.boxIds.map((id) => boxById.get(id));
  if (chosen.some((b) => !b)) return fail('존재하지 않는 박스가 포함돼 있습니다.');

  const liveItems = (items ?? [])
    .filter((i) => i.change_status !== 'cancelled')
    .map((i) => ({ ...i, quantity: Number(i.quantity) - Number(i.unshipped_quantity ?? 0) }))
    .filter((i) => i.quantity > EPSILON);
  const { data: products } = await supabase
    .from('products')
    .select('name, needs_mulbong')
    .in('name', [...new Set(liveItems.map((i) => i.product_name_raw))]);
  const needsMulbong = new Map((products ?? []).map((p) => [p.name, p.needs_mulbong]));
  const packingItems: PackingItem[] = liveItems.map((i) => ({
    name: i.product_name_raw,
    unit: i.unit,
    quantity: i.quantity,
    mulbongFlag: i.is_mulbong || (needsMulbong.get(i.product_name_raw) ?? false),
  }));

  // 모델을 못 불러와도(저장 실패 등) 기본 규칙으로 배정할 수 있게 빈 모델로 대신한다.
  const model = (await getTodayModel(supabase, todayKST())) ?? trainModel([], { version: 'fallback', trainedAt: new Date().toISOString() });
  const assigned = assignToBoxes(
    model,
    packingItems,
    chosen.map((b) => ({ boxName: b!.name, isMulbongBox: b!.is_mulbong_box })),
  );
  return {
    error: null,
    boxes: assigned.map((a) => ({ items: a.items.map((it) => ({ orderItemId: liveItems[it.index].id, quantity: it.quantity })) })),
  };
}

export async function deletePackingRecord(dailyBusinessId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: daily } = await supabase.from('daily_businesses').select('order_date').eq('id', dailyBusinessId).maybeSingle();
  if (daily) {
    const dateError = editableDateError(daily.order_date, (await loadAppSettings(supabase)).allowPastOrderEdit);
    if (dateError) return { error: dateError };
  }
  const { error } = await supabase.from('packing_records').delete().eq('daily_business_id', dailyBusinessId);
  if (error) return { error: error.message };
  await supabase.from('daily_businesses').update({ total_boxes: 1 }).eq('id', dailyBusinessId);
  revalidatePath('/packing-log');
  revalidatePath('/dashboard');
  return { error: null };
}
