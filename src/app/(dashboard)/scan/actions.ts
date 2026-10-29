'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isValidBoxBarcode } from '@/lib/labels/barcode';
import { mergeGroupOf, normalizeMergeGroups } from '@/lib/box-merge';
import { requirePermission } from '@/lib/permissions/access';

// 스캔 결과 화면에 보여줄 박스 정보
export interface ScannedBox {
  labelId: string;
  barcode: string;
  business: string;
  terminal: string;
  boxNo: number;
  // 이 업체 카드의 박스 라벨 중 상차 완료된 수 / 발급된 전체 수 (스캔 반영 후)
  loadedCount: number;
  totalCount: number;
  loadedAt: string | null;
  // 합포장으로 묶인 박스 번호(같이 상차 처리된다). 합포장이 아니면 빈 배열
  mergedSeqs: number[];
}

export type ScanResult =
  | { status: 'loaded'; box: ScannedBox } // 방금 상차 완료로 처리됨
  | { status: 'duplicate'; box: ScannedBox } // 이미 상차 완료된 박스를 다시 스캔함
  | { status: 'invalid'; code: string } // 우리 바코드 형식이 아님
  | { status: 'unknown'; code: string }; // 형식은 맞지만 발급된 적 없는 번호

// 스캔 결과 화면에 보여줄 정보를 모은다. 업체 카드·같은 카드의 라벨은 서로 무관해서 같이 읽고, 이름은 그 다음에 한 번에 읽는다.
async function describe(supabase: Awaited<ReturnType<typeof createClient>>, label: { id: string; daily_business_id: string; seq: number; barcode: string; loaded_at: string | null }): Promise<ScannedBox> {
  const [{ data: daily }, { data: siblings }] = await Promise.all([
    supabase.from('daily_businesses').select('business_id, terminal_id, display_name, merge_groups').eq('id', label.daily_business_id).maybeSingle(),
    supabase.from('box_labels').select('loaded_at').eq('daily_business_id', label.daily_business_id),
  ]);
  const [{ data: business }, { data: terminal }] = await Promise.all([
    daily ? supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle() : Promise.resolve({ data: null }),
    daily?.terminal_id ? supabase.from('terminals').select('name').eq('id', daily.terminal_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const all = siblings ?? [];
  return {
    labelId: label.id,
    barcode: label.barcode,
    business: daily?.display_name ?? business?.name ?? '',
    terminal: terminal?.name ?? '',
    boxNo: label.seq,
    loadedCount: all.filter((l) => l.loaded_at).length,
    totalCount: all.length,
    loadedAt: label.loaded_at,
    mergedSeqs: mergeGroupOf(normalizeMergeGroups(daily?.merge_groups), label.seq) ?? [],
  };
}

// 합포장으로 묶인 같은 카드의 박스 번호(스캔한 박스 자신 포함). 묶이지 않았으면 빈 배열.
async function mergedSeqsOf(supabase: Awaited<ReturnType<typeof createClient>>, dailyBusinessId: string, seq: number): Promise<number[]> {
  const { data } = await supabase.from('daily_businesses').select('merge_groups').eq('id', dailyBusinessId).maybeSingle();
  return mergeGroupOf(normalizeMergeGroups(data?.merge_groups), seq) ?? [];
}

// 바코드를 스캔해서 상차 완료로 처리한다. 같은 박스를 다시 스캔하면 상태를 바꾸지 않고 "이미 상차됨"으로 알려준다.
export async function scanBarcode(raw: string): Promise<ScanResult> {
  const code = raw.replace(/\s+/g, '');
  if (!isValidBoxBarcode(code)) {
    await requirePermission('scan:scan');
    return { status: 'invalid', code: code.slice(0, 20) || '빈 값' };
  }

  // 권한 확인과 라벨 조회는 서로 무관하게 같이 보낸다(읽기만 하므로). 상태를 바꾸는 갱신은 권한 확인이 끝난 뒤에만 한다.
  const supabase = await createClient();
  const [, { data: label }] = await Promise.all([
    requirePermission('scan:scan'),
    supabase.from('box_labels').select('id, daily_business_id, seq, barcode, loaded_at').eq('barcode', code).maybeSingle(),
  ]);
  if (!label) return { status: 'unknown', code };

  if (label.loaded_at) return { status: 'duplicate', box: await describe(supabase, label) };

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? null;
  const loadedAt = new Date().toISOString();
  // 동시에 두 번 스캔돼도 한 번만 처리되도록 아직 상차 전인 행만 갱신한다.
  const { data: updated } = await supabase.from('box_labels').update({ loaded_at: loadedAt, loaded_by: userId }).eq('id', label.id).is('loaded_at', null).select('id').maybeSingle();
  if (!updated) {
    const { data: again } = await supabase.from('box_labels').select('id, daily_business_id, seq, barcode, loaded_at').eq('id', label.id).maybeSingle();
    return { status: 'duplicate', box: await describe(supabase, again ?? label) };
  }
  // 합포장으로 묶인 박스는 함께 테이핑되어 라벨이 하나만 보이므로, 묶인 박스를 모두 상차 완료로 처리한다.
  const merged = (await mergedSeqsOf(supabase, label.daily_business_id, label.seq)).filter((n) => n !== label.seq);
  const { data: mates } = merged.length
    ? await supabase.from('box_labels').update({ loaded_at: loadedAt, loaded_by: userId }).eq('daily_business_id', label.daily_business_id).in('seq', merged).is('loaded_at', null).select('id')
    : { data: [] };
  // 이력 기록과 결과 화면용 조회는 서로 무관해서 같이 보낸다.
  const [, box] = await Promise.all([
    supabase.from('box_label_events').insert([label.id, ...(mates ?? []).map((m) => m.id)].map((label_id) => ({ label_id, event: 'scan' as const, created_by: userId }))),
    describe(supabase, { ...label, loaded_at: loadedAt }),
  ]);
  revalidatePath('/scan');
  return { status: 'loaded', box };
}

// 잘못 스캔한 박스를 상차 전 상태로 되돌린다.
export async function undoScan(labelId: string): Promise<{ error: string | null }> {
  await requirePermission('scan:undo');
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: label } = await supabase.from('box_labels').select('daily_business_id, seq').eq('id', labelId).maybeSingle();
  // 합포장으로 함께 상차 처리된 박스도 같이 되돌린다.
  const merged = label ? await mergedSeqsOf(supabase, label.daily_business_id, label.seq) : [];
  const { data: undone, error } = merged.length && label
    ? await supabase.from('box_labels').update({ loaded_at: null, loaded_by: null }).eq('daily_business_id', label.daily_business_id).in('seq', merged).select('id')
    : await supabase.from('box_labels').update({ loaded_at: null, loaded_by: null }).eq('id', labelId).select('id');
  if (error) return { error: error.message };
  const ids = [...new Set([labelId, ...(undone ?? []).map((u) => u.id)])];
  await supabase.from('box_label_events').insert(ids.map((label_id) => ({ label_id, event: 'undo' as const, created_by: claims?.claims.sub ?? null })));
  revalidatePath('/scan');
  return { error: null };
}
