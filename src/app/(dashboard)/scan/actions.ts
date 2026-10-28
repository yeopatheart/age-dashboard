'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isValidBoxBarcode } from '@/lib/labels/barcode';

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
}

export type ScanResult =
  | { status: 'loaded'; box: ScannedBox } // 방금 상차 완료로 처리됨
  | { status: 'duplicate'; box: ScannedBox } // 이미 상차 완료된 박스를 다시 스캔함
  | { status: 'invalid'; code: string } // 우리 바코드 형식이 아님
  | { status: 'unknown'; code: string }; // 형식은 맞지만 발급된 적 없는 번호

async function describe(supabase: Awaited<ReturnType<typeof createClient>>, label: { id: string; daily_business_id: string; seq: number; barcode: string; loaded_at: string | null }): Promise<ScannedBox> {
  const { data: daily } = await supabase.from('daily_businesses').select('business_id, terminal_id').eq('id', label.daily_business_id).maybeSingle();
  const [{ data: business }, { data: terminal }, { data: siblings }] = await Promise.all([
    daily ? supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle() : Promise.resolve({ data: null }),
    daily?.terminal_id ? supabase.from('terminals').select('name').eq('id', daily.terminal_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('box_labels').select('loaded_at').eq('daily_business_id', label.daily_business_id),
  ]);
  const all = siblings ?? [];
  return {
    labelId: label.id,
    barcode: label.barcode,
    business: business?.name ?? '',
    terminal: terminal?.name ?? '',
    boxNo: label.seq,
    loadedCount: all.filter((l) => l.loaded_at).length,
    totalCount: all.length,
    loadedAt: label.loaded_at,
  };
}

// 바코드를 스캔해서 상차 완료로 처리한다. 같은 박스를 다시 스캔하면 상태를 바꾸지 않고 "이미 상차됨"으로 알려준다.
export async function scanBarcode(raw: string): Promise<ScanResult> {
  const code = raw.replace(/\s+/g, '');
  if (!isValidBoxBarcode(code)) return { status: 'invalid', code: code.slice(0, 20) || '빈 값' };

  const supabase = await createClient();
  const { data: label } = await supabase.from('box_labels').select('id, daily_business_id, seq, barcode, loaded_at').eq('barcode', code).maybeSingle();
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
  await supabase.from('box_label_events').insert({ label_id: label.id, event: 'scan', created_by: userId });
  revalidatePath('/scan');
  return { status: 'loaded', box: await describe(supabase, { ...label, loaded_at: loadedAt }) };
}

// 잘못 스캔한 박스를 상차 전 상태로 되돌린다.
export async function undoScan(labelId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { error } = await supabase.from('box_labels').update({ loaded_at: null, loaded_by: null }).eq('id', labelId);
  if (error) return { error: error.message };
  await supabase.from('box_label_events').insert({ label_id: labelId, event: 'undo', created_by: claims?.claims.sub ?? null });
  revalidatePath('/scan');
  return { error: null };
}
