'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { makeBoxBarcode } from '@/lib/labels/barcode';
import { mergeLabelText, normalizeMergeGroups, type MergeGroups } from '@/lib/box-merge';
import { LABEL_PRESETS, LABEL_TEMPLATE_KEY, buildTemplate, parseElements, type LabelData, type LabelPresetKey, type LabelTemplate } from '@/lib/labels/template';
import { LABEL_ACTIVE_DESIGN_KEY, LABEL_MARGIN_KEY, LABEL_ROTATE_KEY, clampLabelMargin, loadCardLabelBase, loadCardLabels, loadLabelDesigns, loadLabelRotate, loadLabelTemplate, type CardLabelBase, type CardLabelInfo, type LabelDesign } from '@/lib/labels/server';
import { requirePermission } from '@/lib/permissions/access';

// ─── 디자인 보관함: 저장·새로 만들기·이름 바꾸기·삭제·사용 중 지정 ───────────────────────────────
// 값은 서버에서 한 번 더 검증한다(buildTemplate). 모두 labels:edit 권한이 필요하다.
const DESIGN_NAME_MAX = 40;
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, DESIGN_NAME_MAX);
const duplicateMessage = '같은 이름의 디자인이 이미 있습니다.';
const isDuplicate = (error: { code?: string }) => error.code === '23505';

const templateRow = (template: LabelTemplate) => ({ width_mm: template.widthMm, height_mm: template.heightMm, elements: template.elements });

export async function saveLabelDesign(id: string, input: LabelTemplate): Promise<{ error: string | null; template: LabelTemplate }> {
  await requirePermission('labels:edit');
  const template = buildTemplate({ width_mm: input.widthMm, height_mm: input.heightMm, elements: parseElements(input.elements) });
  const supabase = await createClient();
  const { error } = await supabase.from('label_designs').update({ ...templateRow(template), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { error: error.message, template };
  revalidatePath('/labels');
  return { error: null, template };
}

// 새 디자인: 프리셋(preset)이나 기존 디자인의 복제(copy)로 시작한다. 사용 중인 디자인이 없으면(처음 만들 때) 이 디자인을 사용 중으로 지정한다.
export async function createLabelDesign(input: { name: string; from: { kind: 'preset'; key: LabelPresetKey } | { kind: 'copy'; id: string } }): Promise<{ error: string | null; design: LabelDesign | null; activeId: string | null }> {
  await requirePermission('labels:edit');
  const name = cleanName(input.name);
  if (!name) return { error: '디자인 이름을 입력해주세요.', design: null, activeId: null };
  const supabase = await createClient();
  const before = await loadLabelDesigns(supabase);
  if (before.missing) return { error: '필요한 마이그레이션(0050)이 아직 적용되지 않았습니다.', design: null, activeId: null };
  let template: LabelTemplate | undefined;
  if (input.from.kind === 'preset') {
    const key = input.from.key;
    template = LABEL_PRESETS.find((p) => p.key === key)?.template;
  } else {
    const id = input.from.id;
    template = before.designs.find((d) => d.id === id)?.template;
  }
  if (!template) return { error: '시작할 디자인을 찾지 못했습니다.', design: null, activeId: before.activeId };
  const { data, error } = await supabase.from('label_designs').insert({ name, ...templateRow(template) }).select('id, name').single();
  if (error) return { error: isDuplicate(error) ? duplicateMessage : error.message, design: null, activeId: before.activeId };
  let activeId = before.activeId;
  if (!activeId) {
    const set = await setActiveDesign(supabase, data.id);
    if (set) return { error: set, design: { id: data.id, name: data.name, template }, activeId: null };
    activeId = data.id;
  }
  revalidatePath('/labels');
  return { error: null, design: { id: data.id, name: data.name, template }, activeId };
}

export async function renameLabelDesign(id: string, name: string): Promise<{ error: string | null; name: string }> {
  await requirePermission('labels:edit');
  const clean = cleanName(name);
  if (!clean) return { error: '디자인 이름을 입력해주세요.', name };
  const supabase = await createClient();
  const { error } = await supabase.from('label_designs').update({ name: clean, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { error: isDuplicate(error) ? duplicateMessage : error.message, name };
  revalidatePath('/labels');
  return { error: null, name: clean };
}

// 사용 중인 디자인과 마지막 하나는 지울 수 없다(출력에 쓸 디자인이 없어지지 않게).
export async function deleteLabelDesign(id: string): Promise<{ error: string | null }> {
  await requirePermission('labels:edit');
  const supabase = await createClient();
  const { designs, activeId } = await loadLabelDesigns(supabase);
  if (id === activeId) return { error: '사용 중인 디자인은 지울 수 없습니다. 다른 디자인을 사용 중으로 바꾼 뒤 지워주세요.' };
  if (designs.length <= 1) return { error: '마지막 디자인은 지울 수 없습니다.' };
  const { error } = await supabase.from('label_designs').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/labels');
  return { error: null };
}

export async function activateLabelDesign(id: string): Promise<{ error: string | null }> {
  await requirePermission('labels:edit');
  const supabase = await createClient();
  const { designs } = await loadLabelDesigns(supabase);
  if (!designs.some((d) => d.id === id)) return { error: '디자인을 찾지 못했습니다.' };
  const error = await setActiveDesign(supabase, id);
  if (error) return { error };
  revalidatePath('/labels');
  revalidatePath('/packing-log');
  return { error: null };
}

async function setActiveDesign(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<string | null> {
  const { error } = await supabase.from('app_settings').upsert({ key: LABEL_ACTIVE_DESIGN_KEY, value: id, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return error ? error.message : null;
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

// 롤 방향에 맞춰 라벨을 90도 돌려 출력하는지 저장(프린터 하나에 하나).
export async function saveLabelRotate(rotate: boolean): Promise<{ error: string | null; rotate: boolean }> {
  await requirePermission('labels:edit');
  const value = rotate === true;
  const supabase = await createClient();
  const { error } = await supabase.from('app_settings').upsert({ key: LABEL_ROTATE_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return { error: error.message, rotate: value };
  revalidatePath('/labels');
  return { error: null, rotate: value };
}

// 박스 할당 화면의 라벨 영역이 처음 열릴 때 읽는다: 박스별 출력 상태 + 미리보기에 필요한 라벨 디자인·공통 값.
// 바코드 번호는 날짜·업체번호·박스 순번으로 정해지므로 미리보기는 발급(DB 쓰기) 없이 화면에서 계산한다.
export interface CardLabelPreviewSource {
  infos: CardLabelInfo[];
  template: LabelTemplate;
  base: CardLabelBase | null;
}

export async function getCardLabels(dailyBusinessId: string): Promise<CardLabelPreviewSource> {
  await requirePermission('packing:view');
  const supabase = await createClient();
  const [infos, template, base] = await Promise.all([loadCardLabels(supabase, dailyBusinessId), loadLabelTemplate(supabase), loadCardLabelBase(supabase, dailyBusinessId)]);
  return { infos, template, base };
}

export interface LabelPrintPayload {
  error: string | null;
  template: LabelTemplate | null;
  labels: LabelData[];
  infos: CardLabelInfo[];
  rotated: boolean; // 롤 방향에 맞춰 90도 돌려 출력하는 설정(라벨 설정 화면)
}

// 박스 순번(seqs)의 라벨을 출력할 준비를 한다: 아직 바코드가 없는 순번에는 바코드를 발급하고, 출력 이력을 남기고,
// 인쇄에 필요한 라벨 디자인과 값을 돌려준다. 같은 박스를 다시 부르면 같은 바코드로 재출력이 된다.
export async function prepareLabelPrint(input: { dailyBusinessId: string; seqs: number[] }): Promise<LabelPrintPayload> {
  await requirePermission('packing:print');
  const fail = (error: string): LabelPrintPayload => ({ error, template: null, labels: [], infos: [], rotated: false });
  const seqs = [...new Set(input.seqs)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 99).sort((a, b) => a - b);
  if (seqs.length === 0) return fail('출력할 박스를 선택해주세요.');

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? null;

  const [base, template, rotated, { data: existing }] = await Promise.all([
    loadCardLabelBase(supabase, input.dailyBusinessId),
    loadLabelTemplate(supabase),
    loadLabelRotate(supabase),
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
  await supabase.from('box_label_events').insert(ids.map((label_id) => ({ label_id, event: 'print' as const, label_kind: LABEL_TEMPLATE_KEY, created_by: userId })));

  const labels: LabelData[] = seqs.map((seq) => ({ ...base.data, boxNo: seq, barcode: labelBySeq.get(seq)!.barcode, merge: mergeLabelText(base.mergeGroups, seq) }));
  revalidatePath('/packing-log');
  return { error: null, template, labels, infos: await loadCardLabels(supabase, input.dailyBusinessId), rotated };
}

// 합포장 묶음 저장(박스 할당 화면의 라벨 영역). 묶음을 바꾸면 이미 출력한 라벨의 합포장 표시가 달라지므로 화면에서 다시 출력하도록 안내한다.
export async function saveMergeGroups(dailyBusinessId: string, groups: MergeGroups): Promise<{ error: string | null; groups: MergeGroups }> {
  await requirePermission('packing:submit');
  const normalized = normalizeMergeGroups(groups);
  const supabase = await createClient();
  const { error } = await supabase.from('daily_businesses').update({ merge_groups: normalized }).eq('id', dailyBusinessId);
  if (error) return { error: error.message, groups: normalized };
  revalidatePath('/packing-log');
  revalidatePath('/dashboard');
  revalidatePath('/overview');
  return { error: null, groups: normalized };
}
