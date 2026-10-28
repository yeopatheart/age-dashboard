// 박스 추천의 DB 연결부. 모델 자체(model.ts)는 DB를 모르고, 여기서 기록을 읽어 학습시키고 추천을 스냅샷으로 저장한다.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { recommend, trainModel, type Confidence, type PackingItem, type PackingModel, type TrainingRecord } from './model';
import { fetchAll } from '@/lib/supabase/fetch-all';

type Client = SupabaseClient<Database>;


// ─── 저장·표시용 타입 ───────────────────────────────────────────────────────
export interface StoredBox {
  boxId: string;
  boxName: string;
  isMulbongBox: boolean;
  items: { orderItemId: string; quantity: number }[];
}
export interface StoredPlan {
  boxes: StoredBox[];
  score: number;
}
export interface RecommendationView {
  modelVersion: string;
  confidence: Confidence;
  confidenceScore: number;
  candidates: StoredPlan[];
}
export interface LiveOrderItem {
  id: string;
  name: string;
  unit: string;
  quantity: number; // 주문 − 미출고
  mulbongFlag: boolean;
}
export interface BoxLookup {
  id: string;
  name: string;
  is_mulbong_box: boolean;
}

// 주문 내용이 바뀌었는지 알아보는 짧은 지문. 상품·단위·수량(미출고 반영)이 같으면 같은 값이다.
export function orderSignature(items: LiveOrderItem[]): string {
  const text = items
    .map((i) => `${i.name}|${i.unit}|${Math.round(i.quantity * 100) / 100}`)
    .sort()
    .join(';');
  let hash = 0x811c9dc5; // FNV-1a 32bit
  for (let n = 0; n < text.length; n++) {
    hash ^= text.charCodeAt(n);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${items.length}-${hash.toString(16).padStart(8, '0')}`;
}

function parseStoredPlans(value: unknown): StoredPlan[] {
  if (!Array.isArray(value)) return [];
  const plans: StoredPlan[] = [];
  for (const p of value) {
    if (typeof p !== 'object' || p === null || !('boxes' in p) || !Array.isArray(p.boxes)) continue;
    const score = 'score' in p && typeof p.score === 'number' ? p.score : 0;
    plans.push({ boxes: p.boxes as StoredBox[], score });
  }
  return plans;
}

function isPackingModel(value: unknown): value is PackingModel {
  return typeof value === 'object' && value !== null && 'cases' in value && Array.isArray(value.cases) && 'params' in value;
}

// ─── 학습 ───────────────────────────────────────────────────────────────────
async function loadTrainingRecords(supabase: Client, beforeDate: string): Promise<TrainingRecord[]> {
  const [records, boxes, items] = await Promise.all([
    fetchAll((from, to) => supabase.from('packing_records').select('id, order_date, business_name, items_verified').lt('order_date', beforeDate).order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('packing_boxes').select('id, record_id, position, box_name, is_mulbong_box').order('id').range(from, to)),
    fetchAll((from, to) =>
      supabase.from('packing_box_items').select('id, packing_box_id, product_name, unit, quantity, is_mulbong, needs_mulbong').order('id').range(from, to),
    ),
  ]);
  const itemsByBox = new Map<string, PackingItem[]>();
  for (const i of items) {
    const list = itemsByBox.get(i.packing_box_id) ?? [];
    list.push({ name: i.product_name, unit: i.unit, quantity: Number(i.quantity), mulbongFlag: i.is_mulbong || i.needs_mulbong });
    itemsByBox.set(i.packing_box_id, list);
  }
  const boxesByRecord = new Map<string, typeof boxes>();
  for (const b of boxes) {
    const list = boxesByRecord.get(b.record_id) ?? [];
    list.push(b);
    boxesByRecord.set(b.record_id, list);
  }
  return records
    .map((r) => ({
      orderDate: r.order_date,
      businessName: r.business_name,
      itemsVerified: r.items_verified !== false,
      boxes: (boxesByRecord.get(r.id) ?? [])
        .sort((a, b) => a.position - b.position)
        .map((b) => ({ boxName: b.box_name, isMulbongBox: b.is_mulbong_box, items: itemsByBox.get(b.id) ?? [] })),
    }))
    .filter((r) => r.boxes.length > 0);
}

// 오늘 모델 버전을 돌려준다. 오늘 버전이 아직 없으면 어제까지의 제출 기록으로 새로 학습해 저장한다
// ("그날 첫 접속 시 자동 갱신"). 학습은 기록 수백 건 규모에서 수십 ms라 접속을 느리게 하지 않는다.
// 오늘 제출된 기록은 포함하지 않는다 — 하루 동안 추천이 흔들리지 않고, 오늘의 정답이 오늘의 추천에 새지 않는다.
export async function getTodayModel(supabase: Client, today: string): Promise<PackingModel | null> {
  const version = `v-${today}`;
  const read = async () => {
    const { data } = await supabase.from('packing_model_versions').select('model').eq('version', version).maybeSingle();
    return data && isPackingModel(data.model) ? data.model : null;
  };
  const existing = await read();
  if (existing) return existing;

  const records = await loadTrainingRecords(supabase, today);
  const model = trainModel(records, { version, trainedAt: new Date().toISOString() });
  // 두 사람이 동시에 처음 접속해도 한 번만 저장된다(먼저 저장된 것이 이긴다).
  const { error } = await supabase
    .from('packing_model_versions')
    .upsert({ version, record_count: model.recordCount, single_box_count: model.singleBoxCount, model }, { onConflict: 'version', ignoreDuplicates: true });
  if (error) return null;
  return (await read()) ?? model;
}

// ─── 추천 스냅샷 ────────────────────────────────────────────────────────────
export interface BusinessForRecommendation {
  dailyBusinessId: string;
  items: LiveOrderItem[];
  submitted: boolean;
}
export interface RecommendationState {
  current: RecommendationView | null;
  // 미제출: 추천을 만든 뒤 주문이 바뀌었다. 제출: 제출한 뒤 주문이 바뀌었다 → 박스 재확인 필요
  orderChanged: boolean;
}

// 미제출 업체마다 현재 주문 내용에 대한 추천이 없으면 만들어 저장한다. 이미 제출된 업체는 건드리지 않는다
// (정답을 안 뒤에 만든 추천이 정확도 측정에 섞이지 않게).
// 모델은 추천을 새로 만들어야 할 때만 불러온다(loadModel). 이미 저장된 추천만으로 화면이 채워지면 모델 JSON(이력에 비례해 커진다)을 받지 않는다.
export async function ensureRecommendations(
  supabase: Client,
  loadModel: () => Promise<PackingModel | null>,
  businesses: BusinessForRecommendation[],
  boxByName: Map<string, BoxLookup>,
): Promise<Map<string, RecommendationState>> {
  const result = new Map<string, RecommendationState>();
  const ids = businesses.map((b) => b.dailyBusinessId);
  const existing = ids.length
    ? await fetchAll((from, to) =>
        supabase
          .from('packing_recommendations')
          .select('daily_business_id, model_version, order_signature, confidence, confidence_score, candidates, created_at')
          .in('daily_business_id', ids)
          .order('created_at')
          .range(from, to),
      )
    : [];
  const byDaily = new Map<string, typeof existing>();
  for (const r of existing) byDaily.set(r.daily_business_id, [...(byDaily.get(r.daily_business_id) ?? []), r]);

  let modelPromise: Promise<PackingModel | null> | null = null;
  const getModel = () => (modelPromise ??= loadModel());

  const toInsert: Database['public']['Tables']['packing_recommendations']['Insert'][] = [];
  const pending: { dailyBusinessId: string; view: RecommendationView; changed: boolean }[] = [];

  for (const b of businesses) {
    const signature = orderSignature(b.items);
    const rows = byDaily.get(b.dailyBusinessId) ?? [];
    const matching = rows.find((r) => r.order_signature === signature);
    if (matching) {
      result.set(b.dailyBusinessId, {
        current: {
          modelVersion: matching.model_version,
          confidence: matching.confidence,
          confidenceScore: Number(matching.confidence_score),
          candidates: parseStoredPlans(matching.candidates),
        },
        orderChanged: rows.length >= 2,
      });
      continue;
    }
    if (b.submitted || b.items.length === 0) {
      result.set(b.dailyBusinessId, { current: null, orderChanged: false });
      continue;
    }
    const model = await getModel();
    if (!model) {
      result.set(b.dailyBusinessId, { current: null, orderChanged: rows.length >= 1 });
      continue;
    }
    const rec = recommend(model, b.items.map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity, mulbongFlag: i.mulbongFlag })));
    // 박스 이름이 박스 관리에 없는 후보(이름이 바뀌었거나 삭제된 박스)는 쓸 수 없어 뺀다.
    const candidates: StoredPlan[] = rec.candidates
      .map((p) => ({
        score: p.score,
        boxes: p.boxes.map((box) => ({
          boxId: boxByName.get(box.boxName)?.id ?? '',
          boxName: box.boxName,
          isMulbongBox: box.isMulbongBox,
          items: box.items.map((it) => ({ orderItemId: b.items[it.index].id, quantity: it.quantity })),
        })),
      }))
      .filter((p) => p.boxes.every((box) => box.boxId !== ''));
    if (candidates.length === 0) {
      result.set(b.dailyBusinessId, { current: null, orderChanged: rows.length >= 1 });
      continue;
    }
    toInsert.push({
      daily_business_id: b.dailyBusinessId,
      model_version: rec.modelVersion,
      order_signature: signature,
      confidence: rec.confidence,
      confidence_score: rec.confidenceScore,
      candidates,
    });
    pending.push({
      dailyBusinessId: b.dailyBusinessId,
      view: { modelVersion: rec.modelVersion, confidence: rec.confidence, confidenceScore: rec.confidenceScore, candidates },
      changed: rows.length >= 1,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from('packing_recommendations')
      .upsert(toInsert, { onConflict: 'daily_business_id,order_signature', ignoreDuplicates: true });
    // 저장에 실패해도 화면에는 추천을 보여준다(다음 접속 때 다시 시도한다).
    if (error) console.error('박스 추천 저장 실패:', error.message);
  }
  for (const p of pending) result.set(p.dailyBusinessId, { current: p.view, orderChanged: p.changed });
  return result;
}

// ─── 제출 시 비교 ───────────────────────────────────────────────────────────
const boxNamesKey = (boxes: { boxName: string }[]) => boxes.map((b) => b.boxName).sort().join('+');
const placementKey = (boxes: StoredBox[]) =>
  boxes
    .map((b) => `${b.boxName}:${b.items.map((i) => `${i.orderItemId}=${Math.round(i.quantity * 100) / 100}`).sort().join(',')}`)
    .sort()
    .join('|');

export interface SubmissionComparison {
  recommendation_id: string | null;
  recommended_rank: number | null;
  accepted_as_is: boolean | null;
}

// 제출한 박스 구성을 그 업체의 최신 추천(제출 시점 주문 내용과 같은 것)과 비교한다. 추천이 없으면 전부 null.
export async function compareWithRecommendation(
  supabase: Client,
  dailyBusinessId: string,
  signature: string,
  submitted: StoredBox[],
): Promise<SubmissionComparison> {
  const none = { recommendation_id: null, recommended_rank: null, accepted_as_is: null };
  const { data } = await supabase
    .from('packing_recommendations')
    .select('id, candidates')
    .eq('daily_business_id', dailyBusinessId)
    .eq('order_signature', signature)
    .maybeSingle();
  if (!data) return none;
  const plans = parseStoredPlans(data.candidates);
  const rankIndex = plans.findIndex((p) => boxNamesKey(p.boxes) === boxNamesKey(submitted));
  return {
    recommendation_id: data.id,
    recommended_rank: rankIndex >= 0 ? rankIndex + 1 : null,
    accepted_as_is: plans.length > 0 && placementKey(plans[0].boxes) === placementKey(submitted),
  };
}

// ─── 대시보드 알림 ──────────────────────────────────────────────────────────
// 박스 구성을 정한 뒤(제출했거나, 박스 기록 화면에서 추천을 만든 뒤) 주문이 바뀐 업체를 찾는다.
// 기준이 되는 지문은 제출 기록이 있으면 그 지문, 없으면 가장 최근 추천의 지문이다. 박스 준비를 한 적 없으면 알리지 않는다.
export function findChangedAfterPacking(
  orders: { dailyBusinessId: string; items: LiveOrderItem[] }[],
  records: { daily_business_id: string; order_signature: string | null }[],
  recs: { daily_business_id: string; order_signature: string; created_at: string }[], // created_at 오름차순
): Set<string> {
  const reference = new Map<string, string>();
  for (const r of recs) reference.set(r.daily_business_id, r.order_signature); // 나중 것이 덮어써서 가장 최근 추천이 남는다
  for (const r of records) if (r.order_signature) reference.set(r.daily_business_id, r.order_signature);
  const changed = new Set<string>();
  for (const o of orders) {
    const ref = reference.get(o.dailyBusinessId);
    if (ref && ref !== orderSignature(o.items)) changed.add(o.dailyBusinessId);
  }
  return changed;
}
