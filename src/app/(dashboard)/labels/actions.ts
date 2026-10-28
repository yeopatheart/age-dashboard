'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { makeBoxBarcode } from '@/lib/labels/barcode';
import { buildTemplate, parseElements, type LabelData, type LabelKind, type LabelTemplate } from '@/lib/labels/template';
import { LABEL_MARGIN_KEY, clampLabelMargin, loadCardLabelBase, loadCardLabels, loadLabelTemplates, type CardLabelBase, type CardLabelInfo } from '@/lib/labels/server';
import { requirePermission } from '@/lib/permissions/access';

// 라벨 디자인 저장(종류별로 한 행). 값은 서버에서 한 번 더 검증한다.
export async function saveLabelTemplate(input: LabelTemplate): Promise<{ error: string | null; template: LabelTemplate }> {
  await requirePermission('labels:edit');
  if (input.kind !== 'top' && input.kind !== 'side') return { error: '라벨 종류가 올바르지 않습니다.', template: input };
  const template = buildTemplate(input.kind, { width_mm: input.widthMm, height_mm: input.heightMm, elements: parseElements(input.elements) });
  const supabase = await createClient();
  const { error } = await supabase
    .from('label_templates')
    .upsert({ kind: template.kind, width_mm: template.widthMm, height_mm: template.heightMm, elements: template.elements, updated_at: new Date().toISOString() }, { onConflict: 'kind' });
  if (error) return { error: error.message, template };
  revalidatePath('/labels');
  return { error: null, template };
}

// 프린터 출력 여백 저장(라벨 종류와 무관하게 프린터 하나에 하나).
export async function saveLabelMargin(mm: number): Promise<{ error: string | null; marginMm: number }> {
  await requirePermission('labels:edit');
  const marginMm = clampLabelMargin(mm);
  const supabase = await createClient();
  const { error } = await supabase.from('app_settings').upsert({ key: LABEL_MARGIN_KEY, value: marginMm, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return { error: error.message, marginMm };
  revalidatePath('/labels');
  return { error: null, marginMm };
}

// 박스 할당 화면의 라벨 영역이 처음 열릴 때 읽는다: 박스별 출력 상태 + 미리보기에 필요한 라벨 디자인·공통 값.
// 바코드 번호는 날짜·업체번호·박스 순번으로 정해지므로 미리보기는 발급(DB 쓰기) 없이 화면에서 계산한다.
export interface CardLabelPreviewSource {
  infos: CardLabelInfo[];
  templates: Record<LabelKind, LabelTemplate>;
  base: CardLabelBase | null;
}

export async function getCardLabels(dailyBusinessId: string): Promise<CardLabelPreviewSource> {
  await requirePermission('packing:view');
  const supabase = await createClient();
  const [infos, templates, base] = await Promise.all([loadCardLabels(supabase, dailyBusinessId), loadLabelTemplates(supabase), loadCardLabelBase(supabase, dailyBusinessId)]);
  return { infos, templates, base };
}

export interface LabelPrintPayload {
  error: string | null;
  template: LabelTemplate | null;
  labels: LabelData[];
  infos: CardLabelInfo[];
}

// 박스 순번(seqs)의 라벨을 출력할 준비를 한다: 아직 바코드가 없는 순번에는 바코드를 발급하고, 출력 이력을 남기고,
// 인쇄에 필요한 라벨 디자인과 값을 돌려준다. 같은 박스를 다시 부르면 같은 바코드로 재출력이 된다.
export async function prepareLabelPrint(input: { dailyBusinessId: string; seqs: number[]; kind: LabelKind }): Promise<LabelPrintPayload> {
  await requirePermission('packing:print');
  const fail = (error: string): LabelPrintPayload => ({ error, template: null, labels: [], infos: [] });
  const seqs = [...new Set(input.seqs)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 99).sort((a, b) => a - b);
  if (seqs.length === 0) return fail('출력할 박스를 선택해주세요.');
  if (input.kind !== 'top' && input.kind !== 'side') return fail('라벨 종류가 올바르지 않습니다.');

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? null;

  const [base, templates, { data: existing }] = await Promise.all([
    loadCardLabelBase(supabase, input.dailyBusinessId),
    loadLabelTemplates(supabase),
    supabase.from('box_labels').select('id, seq, barcode').eq('daily_business_id', input.dailyBusinessId),
  ]);
  if (!base) return fail('업체 주문을 찾지 못했습니다.');

  const labelBySeq = new Map((existing ?? []).map((l) => [l.seq, l]));
  const missing = seqs.filter((s) => !labelBySeq.has(s));
  if (missing.length > 0) {
    let rows;
    try {
      rows = missing.map((seq) => ({ daily_business_id: input.dailyBusinessId, seq, barcode: makeBoxBarcode(base.orderDate, base.businessNumber, seq) }));
    } catch (e) {
      return fail(e instanceof Error ? e.message : '바코드를 만들지 못했습니다.');
    }
    const { data: created, error } = await supabase.from('box_labels').upsert(rows, { onConflict: 'daily_business_id,seq' }).select('id, seq, barcode');
    if (error) return fail(error.message);
    for (const l of created ?? []) labelBySeq.set(l.seq, l);
  }

  const ids = seqs.flatMap((s) => (labelBySeq.get(s) ? [labelBySeq.get(s)!.id] : []));
  if (ids.length !== seqs.length) return fail('바코드를 발급하지 못한 박스가 있습니다. 다시 시도해주세요.');
  await supabase.from('box_label_events').insert(ids.map((label_id) => ({ label_id, event: 'print' as const, label_kind: input.kind, created_by: userId })));

  const labels: LabelData[] = seqs.map((seq) => ({ ...base.data, boxNo: seq, barcode: labelBySeq.get(seq)!.barcode }));
  revalidatePath('/packing-log');
  return { error: null, template: templates[input.kind], labels, infos: await loadCardLabels(supabase, input.dailyBusinessId) };
}
