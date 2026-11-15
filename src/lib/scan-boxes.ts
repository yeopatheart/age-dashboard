// 상차 현황에서 한 업체 카드의 박스를 세는 규칙.
// 전체 박스 수는 라벨 행 수가 아니라 **제출한 박스 수**다(2026-11-15 점검): 라벨을 일부만 출력했거나, 박스를 늘린 뒤 새 라벨을 아직 뽑지 않았는데
// 라벨 행 수로 세면 "1/1 이 업체 상차 완료"로 보여 한 박스를 놓치고 출발할 수 있다. 라벨 행이 없는 박스는 상차되지 않은 박스로 센다.
// 제출 기록이 없는 카드(기록을 삭제한 뒤)는 예전처럼 라벨 행 기준으로 센다.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

export interface LabelState {
  seq: number;
  loaded_at: string | null;
}

export interface CardBox {
  seq: number;
  loaded: boolean;
}

export function cardBoxes(labels: LabelState[], submittedBoxes: number | null): CardBox[] {
  if (submittedBoxes === null) return labels.map((l) => ({ seq: l.seq, loaded: l.loaded_at !== null }));
  const bySeq = new Map(labels.map((l) => [l.seq, l]));
  // 박스 번호 1..N이 제출한 박스다. N을 넘는 번호의 라벨 행(박스를 줄인 뒤 남은 옛 라벨)은 세지 않는다.
  return Array.from({ length: submittedBoxes }, (_, i) => ({ seq: i + 1, loaded: bySeq.get(i + 1)?.loaded_at != null }));
}

// 카드별 제출한 박스 수. 제출 기록이 없는 카드는 맵에 없다.
export async function loadSubmittedBoxCounts(supabase: SupabaseClient<Database>, dailyBusinessIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (dailyBusinessIds.length === 0) return counts;
  const { data: records, error } = await supabase.from('packing_records').select('id, daily_business_id').in('daily_business_id', dailyBusinessIds);
  if (error) throw new Error(`박스 기록 조회 실패: ${error.message}`);
  const recordIds = (records ?? []).map((r) => r.id);
  if (recordIds.length === 0) return counts;
  const { data: boxes, error: boxError } = await supabase.from('packing_boxes').select('record_id').in('record_id', recordIds);
  if (boxError) throw new Error(`박스 기록 조회 실패: ${boxError.message}`);
  const perRecord = new Map<string, number>();
  for (const b of boxes ?? []) perRecord.set(b.record_id, (perRecord.get(b.record_id) ?? 0) + 1);
  for (const r of records ?? []) counts.set(r.daily_business_id, perRecord.get(r.id) ?? 0);
  return counts;
}
