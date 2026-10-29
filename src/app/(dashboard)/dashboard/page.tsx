import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import type { OrderItem, OrderRow } from '@/lib/orders';
import { findChangedAfterPacking } from '@/lib/packing/server';
import { boxStatesOf, type LabelRow } from '@/lib/overview';
import { DashboardClient } from './dashboard-client';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { headers } from 'next/headers';
import { todayKST } from '@/lib/order-date';

// 조인을 얕은 여러 쿼리로 나눠서 처리한다 — database.ts가 아직 손으로 쓴 임시 타입이라
// Supabase의 중첩 select(embedding) 타입 추론에 기대지 않고, 각 테이블을 그대로 select해서
// 여기서 직접 맵으로 합친다. 실제 프로젝트 연결 후 생성 타입으로 교체하면 임베딩으로 단순화 가능.
//
// 행(row)은 order_item이 아니라 daily_business 기준으로 만든다 — "새 주문 추가"로 방금 만든,
// 아직 상품이 하나도 없는 업체도 매트릭스에 빈 줄로 보여야 하기 때문이다.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  // 휴대폰이면 처음부터 모바일 화면을 그린다(서버는 화면 폭을 모르므로 기기 종류로 판단하고, 브라우저가 폭으로 다시 확정한다).
  const initialMobile = /Mobile|Android|iPhone|iPod/i.test((await headers()).get('user-agent') ?? '');
  const accessCheck = requireMenu('dashboard'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 마지막에 await로 확정)
  const supabase = await createClient();
  const today = todayKST();
  // ?date=YYYY-MM-DD로 과거 날짜를 조회한다. 형식이 틀리거나 미래면 오늘로 본다.
  const { date } = await searchParams;
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;

  // 1단계: 서로 의존하지 않는 조회는 한 번에 보낸다 — 순서대로 await하면 DB 왕복 시간이 그대로 더해진다.
  // businessDirectory는 "새 주문 추가" 검색용이자(전체 업체), 오늘 카드의 업체명/터미널 조회용이기도 해서
  // 오늘 업체만 따로 다시 조회하지 않는다. 업체·상품은 1000개를 넘을 수 있어 페이지로 나눠 모두 읽는다.
  const [, { data: allTerminals, error: terminalError }, businessRows, { data: dailyBusinesses, error: dailyError }, productRows, settings, { data: highlightRows, error: highlightError }] =
    await Promise.all([
      accessCheck,
      supabase.from('terminals').select('id, name, fill_color, border_color, is_separate, is_parcel').order('name'),
      fetchAll((from, to) => supabase.from('businesses').select('id, name, terminal_id').order('name').order('id').range(from, to), '업체 조회 실패: '),
      supabase
        .from('daily_businesses')
        .select('id, business_id, business_number, round, memo, terminal_id, display_name')
        .eq('order_date', orderDate)
        .order('sort_order'),
      fetchAll((from, to) => supabase.from('products').select('name, fill_color, border_color').order('id').range(from, to), '상품 조회 실패: '),
      loadAppSettings(supabase),
      supabase.from('daily_product_highlights').select('product_name, position').eq('order_date', orderDate).order('position'),
    ]);
  if (highlightError) throw new Error(`강조 상품 조회 실패(마이그레이션 0023 적용 필요): ${highlightError.message}`);

  // 조회 오류(예: 아직 적용 안 된 마이그레이션의 컬럼)를 빈 화면으로 삼키면 "주문이 사라진 것"처럼 보인다.
  if (dailyError) throw new Error(`대시보드 조회 실패: ${dailyError.message}`);
  if (terminalError) throw new Error(`터미널 조회 실패: ${terminalError.message}`);
  const dailyBusinessRows = dailyBusinesses ?? [];
  const dailyBusinessIds = dailyBusinessRows.map((d) => d.id);

  // 2단계: 오늘 카드 id가 정해지면 주문 줄·박스 제출 기록·추천 기록을 한 번에 읽는다.
  const [{ data: orderItemRows }, { data: packingRecordRows }, { data: recommendationRows }, { data: labelRows }] = dailyBusinessIds.length
    ? await Promise.all([
        supabase
          .from('order_items')
          .select('id, daily_business_id, product_sequence, product_id, product_name_raw, quantity, unit, secondary_weight_kg, measured_weight_kg, size_request, is_mulbong, is_packed, unshipped_quantity, unshipped_reason, change_status')
          .in('daily_business_id', dailyBusinessIds),
        supabase.from('packing_records').select('id, daily_business_id, order_signature').in('daily_business_id', dailyBusinessIds),
        supabase.from('packing_recommendations').select('daily_business_id, order_signature, created_at').in('daily_business_id', dailyBusinessIds).order('created_at'),
        supabase.from('box_labels').select('daily_business_id, seq, loaded_at').in('daily_business_id', dailyBusinessIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  // 3단계: "박스" 열은 박스 할당에서 제출한 박스 수다 — 대시보드에서 따로 입력하지 않으므로 제출 기록에서 바로 센다.
  const recordIds = (packingRecordRows ?? []).map((r) => r.id);
  const { data: packingBoxRows } = recordIds.length
    ? await supabase.from('packing_boxes').select('record_id').in('record_id', recordIds)
    : { data: [] };
  const dailyByRecordId = new Map((packingRecordRows ?? []).map((r) => [r.id, r.daily_business_id]));
  const boxCountByDaily = new Map<string, number>();
  for (const box of packingBoxRows ?? []) {
    const dailyId = dailyByRecordId.get(box.record_id);
    if (dailyId) boxCountByDaily.set(dailyId, (boxCountByDaily.get(dailyId) ?? 0) + 1);
  }

  const labelsByDaily = new Map<string, LabelRow[]>();
  for (const label of labelRows ?? []) {
    const list = labelsByDaily.get(label.daily_business_id) ?? [];
    list.push({ seq: label.seq, loaded: !!label.loaded_at });
    labelsByDaily.set(label.daily_business_id, list);
  }

  const terminalNameById = new Map((allTerminals ?? []).map((t) => [t.id, t.name]));
  const parcelTerminalIds = new Set((allTerminals ?? []).filter((t) => t.is_parcel).map((t) => t.id));
  const businessById = new Map(businessRows.map((b) => [b.id, b]));

  const rows: OrderRow[] = dailyBusinessRows.flatMap((daily) => {
    const business = businessById.get(daily.business_id);
    if (!business) return [];
    const parcel = !!daily.terminal_id && parcelTerminalIds.has(daily.terminal_id);
    const totalBoxes = boxCountByDaily.get(daily.id) ?? (parcel ? 1 : null);
    return [
      {
        dailyBusinessId: daily.id,
        businessId: business.id,
        businessName: daily.display_name ?? business.name,
        defaultName: business.name,
        // 터미널은 그날 카드의 값이다(고객사의 터미널은 기본값일 뿐, 날짜별로 다를 수 있다).
        terminal: daily.terminal_id ? terminalNameById.get(daily.terminal_id) ?? '' : '',
        businessNumber: daily.business_number,
        round: daily.round,
        // 박스 할당에서 제출한 박스 수. 택배 터미널은 아직 할당 전이면 1박스로 보고, 박스 할당에서 박스 수가 정해지면 그 수로 바뀐다.
        totalBoxes,
        memo: daily.memo,
        parcel,
        boxStates: parcel ? [] : boxStatesOf(totalBoxes, labelsByDaily.get(daily.id) ?? []),
      },
    ];
  });

  // 박스 구성을 정한 뒤 주문이 바뀐 업체에는 이름 옆에 작은 "박스" 배지를 단다(박스 상세는 박스 기록 화면에서 본다).
  const changedAfterPacking = findChangedAfterPacking(
    dailyBusinessIds.map((id) => ({
      dailyBusinessId: id,
      items: (orderItemRows ?? [])
        .filter((r) => r.daily_business_id === id && r.change_status !== 'cancelled' && Number(r.quantity) - Number(r.unshipped_quantity ?? 0) > 0)
        .map((r) => ({ id: r.id, name: r.product_name_raw, unit: r.unit, quantity: Number(r.quantity) - Number(r.unshipped_quantity ?? 0), mulbongFlag: r.is_mulbong })),
    })),
    packingRecordRows ?? [],
    recommendationRows ?? [],
  );
  for (const row of rows) row.packingChanged = changedAfterPacking.has(row.dailyBusinessId);

  const rowByDailyBusinessId = new Map(rows.map((r) => [r.dailyBusinessId, r]));

  const items: OrderItem[] = (orderItemRows ?? []).flatMap((row) => {
    const orderRow = rowByDailyBusinessId.get(row.daily_business_id);
    if (!orderRow) return [];

    return [
      {
        id: row.id,
        dailyBusinessId: orderRow.dailyBusinessId,
        businessId: orderRow.businessId,
        businessName: orderRow.businessName,
        terminal: orderRow.terminal,
        businessNumber: orderRow.businessNumber,
        productSequence: row.product_sequence,
        productId: row.product_id,
        productName: row.product_name_raw,
        quantity: Number(row.quantity),
        unit: row.unit,
        secondaryWeightKg: row.secondary_weight_kg ?? undefined,
        measuredWeightKg: row.measured_weight_kg == null ? undefined : Number(row.measured_weight_kg),
        sizeRequest: row.size_request ?? undefined,
        isMulbong: row.is_mulbong,
        isPacked: row.is_packed,
        unshippedQuantity: Number(row.unshipped_quantity ?? 0),
        unshippedReason: row.unshipped_reason ?? undefined,
        changeStatus: row.change_status,
      },
    ];
  });

  return (
    <DashboardClient
      rows={rows}
      items={items}
      allTerminals={allTerminals ?? []}
      businessDirectory={businessRows}
      orderDate={orderDate}
      unshippedReasons={settings.unshippedReasons}
      allowPast={settings.allowPastOrderEdit}
      highlights={(highlightRows ?? []).map((h) => h.product_name)}
      initialMobile={initialMobile}
      productColors={Object.fromEntries(productRows.map((p) => [p.name, { fill: p.fill_color, border: p.border_color }]))}
      today={today}
    />
  );
}
