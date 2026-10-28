// 송장 라벨의 DB 접근(서버 전용): 라벨 디자인 읽기, 업체 카드별 박스 라벨 상태 읽기.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { loadAppSettings } from '@/lib/settings-server';
import { buildTemplate, type LabelData, type LabelKind, type LabelTemplate } from './template';

type Client = SupabaseClient<Database>;

export async function loadLabelTemplates(supabase: Client): Promise<Record<LabelKind, LabelTemplate>> {
  const { data } = await supabase.from('label_templates').select('kind, width_mm, height_mm, elements');
  const byKind = new Map((data ?? []).map((r) => [r.kind, r]));
  return { top: buildTemplate('top', byKind.get('top')), side: buildTemplate('side', byKind.get('side')) };
}

// 박스 한 개(순번 seq)의 라벨 상태. printCount = 지금까지 출력(재출력 포함)한 횟수.
export interface CardLabelInfo {
  seq: number;
  barcode: string;
  printCount: number;
  lastPrintedAt: string | null;
  loadedAt: string | null;
}

export async function loadCardLabels(supabase: Client, dailyBusinessId: string): Promise<CardLabelInfo[]> {
  const { data: labels } = await supabase.from('box_labels').select('id, seq, barcode, loaded_at').eq('daily_business_id', dailyBusinessId).order('seq');
  const rows = labels ?? [];
  if (rows.length === 0) return [];
  const { data: events } = await supabase
    .from('box_label_events')
    .select('label_id, created_at')
    .eq('event', 'print')
    .in('label_id', rows.map((l) => l.id))
    .order('created_at', { ascending: false });
  const printCount = new Map<string, number>();
  const lastPrinted = new Map<string, string>();
  for (const e of events ?? []) {
    printCount.set(e.label_id, (printCount.get(e.label_id) ?? 0) + 1);
    if (!lastPrinted.has(e.label_id)) lastPrinted.set(e.label_id, e.created_at);
  }
  return rows.map((l) => ({ seq: l.seq, barcode: l.barcode, printCount: printCount.get(l.id) ?? 0, lastPrintedAt: lastPrinted.get(l.id) ?? null, loadedAt: l.loaded_at }));
}

// 한 업체 카드의 라벨에 공통으로 들어가는 값(박스 번호·바코드만 박스마다 다르다).
export interface CardLabelBase {
  orderDate: string;
  businessNumber: number;
  data: Omit<LabelData, 'boxNo' | 'barcode'>;
}

export async function loadCardLabelBase(supabase: Client, dailyBusinessId: string): Promise<CardLabelBase | null> {
  const { data: daily } = await supabase.from('daily_businesses').select('id, order_date, business_id, business_number, terminal_id').eq('id', dailyBusinessId).maybeSingle();
  if (!daily) return null;
  const [{ data: business }, { data: terminal }, settings] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle(),
    daily.terminal_id ? supabase.from('terminals').select('name, is_separate').eq('id', daily.terminal_id).maybeSingle() : Promise.resolve({ data: null }),
    loadAppSettings(supabase),
  ]);
  return {
    orderDate: daily.order_date,
    businessNumber: daily.business_number,
    data: {
      terminal: terminal?.name ?? '',
      separate: terminal?.is_separate ?? false,
      business: business?.name ?? '',
      date: daily.order_date,
      company: settings.companyName,
      contact: settings.contactPhone,
    },
  };
}
