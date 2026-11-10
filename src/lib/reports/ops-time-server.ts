// 운영 시간 리포트용 조회(서버 전용). 계산은 ops-time.ts(순수 함수)가 한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll, mapChunks } from '@/lib/supabase/fetch-all';
import { missingTable } from '@/lib/supabase/missing-table';
import { nameWithRound } from '@/lib/orders';
import type { OpsCardInput, OpsItem, OpsLabel } from './ops-time';

type Client = SupabaseClient<Database>;
const CHUNK = 100;

export interface OpsLoad {
  cards: OpsCardInput[];
  submitFromHistory: number; // 박스 할당 시각을 제출 이력(최초 제출)에서 읽은 카드 수. 나머지는 마지막 제출 시각이다
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

// 출고일이 from~to인 업체 카드마다 단계 시각을 모은다.
export async function loadOpsCards(supabase: Client, from: string, to: string): Promise<OpsLoad> {
  const dailies = await fetchAll(
    (a, b) =>
      supabase
        .from('daily_businesses')
        .select('id, order_date, business_id, terminal_id, round, display_name, total_boxes')
        .gte('order_date', from)
        .lte('order_date', to)
        .order('id')
        .range(a, b),
    '업체 카드 조회 실패: ',
  );
  if (dailies.length === 0) return { cards: [], submitFromHistory: 0 };

  const [businesses, terminalsResult] = await Promise.all([
    fetchAll((a, b) => supabase.from('businesses').select('id, name').order('id').range(a, b), '업체 조회 실패: '),
    supabase.from('terminals').select('id, name, is_parcel'),
  ]);
  if (terminalsResult.error) throw new Error(`터미널 조회 실패: ${terminalsResult.error.message}`);
  const businessName = new Map(businesses.map((b) => [b.id, b.name]));
  const terminalById = new Map((terminalsResult.data ?? []).map((t) => [t.id, t]));

  const ids = dailies.map((d) => d.id);
  const [items, records, labels] = await Promise.all([
    mapChunks(ids, CHUNK, (chunk) =>
      fetchAll(
        (a, b) =>
          supabase
            .from('order_items')
            .select('id, daily_business_id, change_status, is_packed, packed_at, quantity, unit, unshipped_quantity')
            .in('daily_business_id', chunk)
            .order('id')
            .range(a, b),
        '주문 줄 조회 실패: ',
      ),
    ),
    mapChunks(ids, CHUNK, (chunk) => fetchAll((a, b) => supabase.from('packing_records').select('id, daily_business_id, submitted_at').in('daily_business_id', chunk).order('id').range(a, b), '박스 제출 기록 조회 실패: ')),
    mapChunks(ids, CHUNK, (chunk) => fetchAll((a, b) => supabase.from('box_labels').select('id, daily_business_id, loaded_at').in('daily_business_id', chunk).order('id').range(a, b), '라벨 조회 실패: ')),
  ]);

  // 라벨 첫 출력 시각(재출력은 제외)
  const printEvents = await mapChunks(labels.map((l) => l.id), CHUNK, (chunk) =>
    fetchAll((a, b) => supabase.from('box_label_events').select('id, label_id, created_at').eq('event', 'print').in('label_id', chunk).order('id').range(a, b), '라벨 출력 이력 조회 실패: '),
  );
  const firstPrint = new Map<string, number>();
  for (const e of printEvents) {
    const t = ms(e.created_at);
    if (t !== null && (!firstPrint.has(e.label_id) || t < (firstPrint.get(e.label_id) as number))) firstPrint.set(e.label_id, t);
  }

  // 박스 할당 최초 제출(0055 이후). 이력 테이블이 아직 없으면 건너뛰고 마지막 제출 시각을 쓴다.
  const firstSubmit = new Map<string, number>();
  try {
    const events = await mapChunks(ids, CHUNK, (chunk) =>
      fetchAll((a, b) => supabase.from('packing_submit_events').select('id, daily_business_id, submitted_at').in('daily_business_id', chunk).order('id').range(a, b), '박스 제출 이력 조회 실패: '),
    );
    for (const e of events) {
      const t = ms(e.submitted_at);
      if (e.daily_business_id && t !== null && (!firstSubmit.has(e.daily_business_id) || t < (firstSubmit.get(e.daily_business_id) as number))) firstSubmit.set(e.daily_business_id, t);
    }
  } catch (e) {
    if (missingTable(e) === null) throw e;
  }

  const roundsByBusinessDate = new Map<string, Set<number>>();
  for (const d of dailies) {
    const key = `${d.order_date}|${d.business_id}`;
    roundsByBusinessDate.set(key, (roundsByBusinessDate.get(key) ?? new Set()).add(d.round));
  }
  const itemsByDaily = new Map<string, OpsItem[]>();
  for (const i of items) {
    const list = itemsByDaily.get(i.daily_business_id) ?? [];
    list.push({ changeStatus: i.change_status, isPacked: i.is_packed, quantity: Number(i.quantity), unit: i.unit, unshippedQuantity: Number(i.unshipped_quantity), packedAt: ms(i.packed_at) });
    itemsByDaily.set(i.daily_business_id, list);
  }
  const labelsByDaily = new Map<string, OpsLabel[]>();
  for (const l of labels) {
    const list = labelsByDaily.get(l.daily_business_id) ?? [];
    list.push({ firstPrintAt: firstPrint.get(l.id) ?? null, loadedAt: ms(l.loaded_at) });
    labelsByDaily.set(l.daily_business_id, list);
  }
  const lastSubmit = new Map(records.map((r) => [r.daily_business_id, ms(r.submitted_at)]));

  let submitFromHistory = 0;
  const cards: OpsCardInput[] = dailies.map((d) => {
    const terminal = d.terminal_id ? terminalById.get(d.terminal_id) : undefined;
    const base = d.display_name ?? businessName.get(d.business_id) ?? '(이름 없음)';
    const split = (roundsByBusinessDate.get(`${d.order_date}|${d.business_id}`)?.size ?? 1) > 1;
    const first = firstSubmit.get(d.id);
    if (first !== undefined) submitFromHistory += 1;
    return {
      id: d.id,
      orderDate: d.order_date,
      name: nameWithRound(base, d.round, split),
      terminal: terminal?.name ?? '미지정',
      parcel: terminal?.is_parcel ?? false,
      boxCount: d.total_boxes > 0 ? d.total_boxes : null,
      submittedAt: first ?? lastSubmit.get(d.id) ?? null,
      labels: labelsByDaily.get(d.id) ?? [],
      items: itemsByDaily.get(d.id) ?? [],
    };
  });
  return { cards, submitFromHistory };
}
