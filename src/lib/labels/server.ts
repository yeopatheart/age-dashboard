// 송장 라벨의 DB 접근(서버 전용): 라벨 디자인 읽기, 업체 카드별 박스 라벨 상태 읽기.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { loadAppSettings } from '@/lib/settings-server';
import { LABEL_TEMPLATE_KEY, buildTemplate, type LabelData, type LabelTemplate } from './template';

type Client = SupabaseClient<Database>;

export async function loadLabelTemplate(supabase: Client): Promise<LabelTemplate> {
  const { data } = await supabase.from('label_templates').select('width_mm, height_mm, top_height_mm, side_width_mm, elements').eq('kind', LABEL_TEMPLATE_KEY).maybeSingle();
  return buildTemplate(data);
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
  const { data: daily } = await supabase.from('daily_businesses').select('id, order_date, business_id, business_number, terminal_id, display_name').eq('id', dailyBusinessId).maybeSingle();
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
      business: daily.display_name ?? business?.name ?? '',
      date: daily.order_date,
      company: settings.companyName,
      contact: settings.contactPhone,
    },
  };
}

// 프린터가 찍지 못하는 가장자리 여백(mm). 라벨 설정 화면에서 빗금으로 보여주고, 여백에 걸친 항목에 경고한다.
// 프린터마다 달라서 app_settings에 따로 저장한다(AppSettings에는 넣지 않는다 — 시스템 설정 저장이 이 값을 덮어쓰지 않게).
export const LABEL_MARGIN_KEY = 'labelMarginMm';
export const DEFAULT_LABEL_MARGIN_MM = 2;
export const clampLabelMargin = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n * 2) / 2)) : DEFAULT_LABEL_MARGIN_MM;
};

export async function loadLabelMargin(supabase: Client): Promise<number> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', LABEL_MARGIN_KEY).maybeSingle();
  return data ? clampLabelMargin(data.value) : DEFAULT_LABEL_MARGIN_MM;
}
