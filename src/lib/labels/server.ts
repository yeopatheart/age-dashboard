// 송장 라벨의 DB 접근(서버 전용): 라벨 디자인 읽기, 업체 카드별 박스 라벨 상태 읽기.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { loadAppSettings } from '@/lib/settings-server';
import { normalizeMergeGroups, type MergeGroups } from '@/lib/box-merge';
import { rowsOrMissing } from '@/lib/supabase/missing-table';
import { DEFAULT_TEMPLATE, buildTemplate, type LabelData, type LabelTemplate } from './template';

type Client = SupabaseClient<Database>;

// 사용 중인 디자인의 id를 저장하는 app_settings 키
export const LABEL_ACTIVE_DESIGN_KEY = 'labelActiveDesign';

export interface LabelDesign {
  id: string;
  name: string;
  template: LabelTemplate;
}

// 저장된 디자인 전부(만든 순서)와 사용 중인 디자인 id. 사용 중 지정이 없거나 지워진 디자인을 가리키면 첫 디자인이 사용 중이다.
// 테이블이 없으면(마이그레이션 0050 전) missing에 테이블 이름을 담아 돌려준다. 그 밖의 오류는 던진다.
export async function loadLabelDesigns(supabase: Client): Promise<{ designs: LabelDesign[]; activeId: string | null; missing: string | null }> {
  const { rows, missing } = await rowsOrMissing(
    (async () => {
      const { data, error } = await supabase.from('label_designs').select('id, name, width_mm, height_mm, elements').order('created_at').order('id');
      if (error) throw new Error(error.message);
      return data ?? [];
    })(),
  );
  if (missing) return { designs: [], activeId: null, missing };
  const designs = rows.map((r) => ({ id: r.id, name: r.name, template: buildTemplate(r) }));
  const { data: setting } = await supabase.from('app_settings').select('value').eq('key', LABEL_ACTIVE_DESIGN_KEY).maybeSingle();
  const saved = typeof setting?.value === 'string' ? setting.value : null;
  const activeId = designs.find((d) => d.id === saved)?.id ?? designs[0]?.id ?? null;
  return { designs, activeId, missing: null };
}

// 출력·미리보기에 쓰는 디자인: 사용 중인 디자인. 저장된 디자인이 없으면 코드의 기본 배치다.
export async function loadLabelTemplate(supabase: Client): Promise<LabelTemplate> {
  const { designs, activeId } = await loadLabelDesigns(supabase);
  return designs.find((d) => d.id === activeId)?.template ?? DEFAULT_TEMPLATE;
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
  data: Omit<LabelData, 'boxNo' | 'barcode' | 'merge'>;
  mergeGroups: MergeGroups; // 합포장 묶음(라벨의 합포장 표시에 쓴다)
}

export async function loadCardLabelBase(supabase: Client, dailyBusinessId: string): Promise<CardLabelBase | null> {
  const { data: daily } = await supabase.from('daily_businesses').select('id, order_date, business_id, business_number, terminal_id, display_name, merge_groups').eq('id', dailyBusinessId).maybeSingle();
  if (!daily) return null;
  const [{ data: business }, { data: terminal }, settings] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', daily.business_id).maybeSingle(),
    daily.terminal_id ? supabase.from('terminals').select('name, is_separate').eq('id', daily.terminal_id).maybeSingle() : Promise.resolve({ data: null }),
    loadAppSettings(supabase),
  ]);
  return {
    orderDate: daily.order_date,
    businessNumber: daily.business_number,
    mergeGroups: normalizeMergeGroups(daily.merge_groups),
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

// 롤 방향에 맞춰 라벨을 90도 돌려 출력할지. 프린터·롤 방향에 따라 정해지므로 여백처럼 app_settings에 따로 저장한다.
export const LABEL_ROTATE_KEY = 'labelRotate';

export async function loadLabelRotate(supabase: Client): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', LABEL_ROTATE_KEY).maybeSingle();
  return data?.value === true;
}

export async function loadLabelMargin(supabase: Client): Promise<number> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', LABEL_MARGIN_KEY).maybeSingle();
  return data ? clampLabelMargin(data.value) : DEFAULT_LABEL_MARGIN_MM;
}
