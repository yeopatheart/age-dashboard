// 박스 리포트용 조회(서버 전용). 계산은 box-usage.ts·packing-accuracy.ts(순수 함수)가 한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll, mapChunks } from '@/lib/supabase/fetch-all';
import { parseStoredPlans } from '@/lib/packing/server';
import type { BoxUseRow } from './box-usage';
import type { AccuracyRecord, SubmitEventLite } from './packing-accuracy';

type Client = SupabaseClient<Database>;
const CHUNK = 100; // .in() 한 번에 넣는 id 수(주소가 너무 길어지지 않게)

export interface BoxReportData {
  usageRows: BoxUseRow[]; // 제출한 박스 한 개마다 한 줄
  accuracyRecords: AccuracyRecord[]; // 추천이 있던 제출 기록(후보를 읽은 것)
  recordCount: number; // 기간 안 제출 기록 수
  withoutRecommendation: number; // 그중 추천이 없던 기록(정확도에서 뺀다)
}

// 기간(출고일 from~to)의 박스 제출 기록. needAccuracy가 false면 추천·상품 조회를 건너뛴다(사용량 보기에는 필요 없다).
export async function loadBoxReportData(supabase: Client, from: string, to: string, needAccuracy: boolean): Promise<BoxReportData> {
  const records = await fetchAll(
    (a, b) =>
      supabase
        .from('packing_records')
        .select('id, order_date, business_name, terminal_name, recommendation_id, recommended_rank, accepted_as_is')
        .gte('order_date', from)
        .lte('order_date', to)
        .order('id')
        .range(a, b),
    '박스 제출 기록 조회 실패: ',
  );
  if (records.length === 0) return { usageRows: [], accuracyRecords: [], recordCount: 0, withoutRecommendation: 0 };
  const recordById = new Map(records.map((r) => [r.id, r]));

  const boxes = await mapChunks(records.map((r) => r.id), CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('packing_boxes').select('id, record_id, box_name, is_mulbong_box').in('record_id', chunk).order('id').range(a, b), '박스 조회 실패: '),
  );

  const usageRows: BoxUseRow[] = boxes.flatMap((box) => {
    const r = recordById.get(box.record_id);
    return r ? [{ orderDate: r.order_date, boxName: box.box_name, businessName: r.business_name, terminalName: r.terminal_name }] : [];
  });

  const withRecommendation = records.filter((r) => r.recommendation_id);
  if (!needAccuracy) return { usageRows, accuracyRecords: [], recordCount: records.length, withoutRecommendation: records.length - withRecommendation.length };

  const recIds = [...new Set(withRecommendation.map((r) => r.recommendation_id as string))];
  const recs = await mapChunks(recIds, CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('packing_recommendations').select('id, model_version, confidence, candidates').in('id', chunk).order('id').range(a, b), '추천 조회 실패: '),
  );
  const recById = new Map(recs.map((r) => [r.id, r]));

  const boxesByRecord = new Map<string, typeof boxes>();
  for (const box of boxes) boxesByRecord.set(box.record_id, [...(boxesByRecord.get(box.record_id) ?? []), box]);

  const boxIds = withRecommendation.flatMap((r) => (boxesByRecord.get(r.id) ?? []).map((b) => b.id));
  const items = await mapChunks(boxIds, CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('packing_box_items').select('packing_box_id, order_item_id, product_name').in('packing_box_id', chunk).order('id').range(a, b), '박스 상품 조회 실패: '),
  );
  const recordOfBox = new Map(boxes.map((b) => [b.id, b.record_id]));
  const productsByRecord = new Map<string, Set<string>>();
  const linesByRecord = new Map<string, Set<string>>();
  for (const item of items) {
    const recordId = recordOfBox.get(item.packing_box_id);
    if (!recordId) continue;
    (productsByRecord.get(recordId) ?? productsByRecord.set(recordId, new Set()).get(recordId)!).add(item.product_name);
    // 한 주문 줄이 여러 박스에 나뉘어도 한 줄로 센다(줄이 지워져 order_item_id가 null이면 상품명으로 센다)
    (linesByRecord.get(recordId) ?? linesByRecord.set(recordId, new Set()).get(recordId)!).add(item.order_item_id ?? `name:${item.product_name}`);
  }

  const accuracyRecords: AccuracyRecord[] = withRecommendation.flatMap((r) => {
    const rec = recById.get(r.recommendation_id as string);
    if (!rec) return [];
    const recordBoxes = boxesByRecord.get(r.id) ?? [];
    const topPlan = parseStoredPlans(rec.candidates)[0];
    return [
      {
        id: r.id,
        orderDate: r.order_date,
        businessName: r.business_name,
        terminalName: r.terminal_name,
        rank: r.recommended_rank,
        asIs: r.accepted_as_is,
        confidence: rec.confidence,
        modelVersion: rec.model_version,
        boxNames: recordBoxes.map((b) => b.box_name),
        topPlanBoxNames: topPlan ? topPlan.boxes.map((b) => b.boxName) : null,
        lineCount: linesByRecord.get(r.id)?.size ?? 0,
        hasMulbongBox: recordBoxes.some((b) => b.is_mulbong_box),
        productNames: [...(productsByRecord.get(r.id) ?? [])],
      },
    ];
  });
  return { usageRows, accuracyRecords, recordCount: records.length, withoutRecommendation: records.length - withRecommendation.length };
}

// 기간의 박스 제출 이력(0055). 테이블이 없으면 호출하는 쪽이 rowsOrMissing으로 감싼다.
export async function loadSubmitEvents(supabase: Client, from: string, to: string): Promise<SubmitEventLite[]> {
  const rows = await fetchAll(
    (a, b) =>
      supabase
        .from('packing_submit_events')
        .select('id, daily_business_id, submitted_at, recommendation_id, recommended_rank, accepted_as_is')
        .gte('order_date', from)
        .lte('order_date', to)
        .order('submitted_at')
        .order('id')
        .range(a, b),
    '박스 제출 이력 조회 실패(마이그레이션 0055 적용 필요): ',
  );
  return rows.map((r) => ({ dailyBusinessId: r.daily_business_id, submittedAt: r.submitted_at, recommendationId: r.recommendation_id, rank: r.recommended_rank, asIs: r.accepted_as_is }));
}

// 박스 종류 이름을 안정된 순서로(색이 박스 종류마다 고정되게). 비활성 박스도 포함한다 — 지난 기간에는 쓰였을 수 있다.
export async function loadBoxOrder(supabase: Client): Promise<string[]> {
  const rows = await fetchAll((a, b) => supabase.from('boxes').select('id, name, created_at').order('created_at').order('id').range(a, b), '박스 종류 조회 실패: ');
  return rows.map((r) => r.name);
}
