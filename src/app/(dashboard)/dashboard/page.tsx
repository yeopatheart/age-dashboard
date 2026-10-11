import { createClient } from '@/lib/supabase/server';
import type { OrderItem, OrderRow } from '@/lib/orders';
import { DashboardClient } from './dashboard-client';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// 조인을 얕은 여러 쿼리로 나눠서 처리한다 — database.ts가 아직 손으로 쓴 임시 타입이라
// Supabase의 중첩 select(embedding) 타입 추론에 기대지 않고, 각 테이블을 그대로 select해서
// 여기서 직접 맵으로 합친다. 실제 프로젝트 연결 후 생성 타입으로 교체하면 임베딩으로 단순화 가능.
//
// 행(row)은 order_item이 아니라 daily_business 기준으로 만든다 — "새 주문 추가"로 방금 만든,
// 아직 상품이 하나도 없는 업체도 매트릭스에 빈 줄로 보여야 하기 때문이다.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await createClient();
  const today = todayKST();
  // ?date=YYYY-MM-DD로 과거 날짜를 조회한다. 형식이 틀리거나 미래면 오늘로 본다.
  const { date } = await searchParams;
  const orderDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;

  // 서로 의존하지 않는 조회는 한 번에 보낸다 — 순서대로 await하면 DB 왕복 시간이 그대로 더해진다.
  // businessDirectory는 "새 주문 추가" 검색용이자(전체 업체), 오늘 카드의 업체명/터미널 조회용이기도 해서
  // 오늘 업체만 따로 다시 조회하지 않는다.
  const [{ data: allTerminals }, { data: businessDirectory }, { data: dailyBusinesses, error: dailyError }] =
    await Promise.all([
      supabase.from('terminals').select('id, name').order('name'),
      supabase.from('businesses').select('id, name, terminal_id').order('name'),
      supabase
        .from('daily_businesses')
        .select('id, business_id, business_number, total_boxes, memo')
        .eq('order_date', orderDate)
        .order('business_number'),
    ]);

  // 조회 오류(예: 아직 적용 안 된 마이그레이션의 컬럼)를 빈 화면으로 삼키면 "주문이 사라진 것"처럼 보인다.
  if (dailyError) throw new Error(`대시보드 조회 실패: ${dailyError.message}`);
  const dailyBusinessRows = dailyBusinesses ?? [];
  const businessRows = businessDirectory ?? [];

  const terminalNameById = new Map((allTerminals ?? []).map((t) => [t.id, t.name]));
  const businessById = new Map(businessRows.map((b) => [b.id, b]));

  const rows: OrderRow[] = dailyBusinessRows.flatMap((daily) => {
    const business = businessById.get(daily.business_id);
    if (!business) return [];
    return [
      {
        dailyBusinessId: daily.id,
        businessId: business.id,
        businessName: business.name,
        terminal: business.terminal_id ? terminalNameById.get(business.terminal_id) ?? '' : '',
        businessNumber: daily.business_number,
        totalBoxes: daily.total_boxes,
        memo: daily.memo,
      },
    ];
  });

  const dailyBusinessIds = dailyBusinessRows.map((d) => d.id);
  const { data: orderItemRows } =
    dailyBusinessIds.length > 0
      ? await supabase.from('order_items').select('*').in('daily_business_id', dailyBusinessIds)
      : { data: [] };

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
        sizeRequest: row.size_request ?? undefined,
        isMulbong: row.is_mulbong,
        measuredValue: row.measured_value ?? undefined,
        isPacked: row.is_packed,
        packedAt: row.packed_at ?? undefined,
        changeStatus: row.change_status,
        boxResult: row.box_result ?? undefined,
        totalBoxes: orderRow.totalBoxes,
      },
    ];
  });

  return (
    <DashboardClient
      rows={rows}
      items={items}
      allTerminals={allTerminals ?? []}
      businessDirectory={businessDirectory ?? []}
      orderDate={orderDate}
      today={today}
    />
  );
}
