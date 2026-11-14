'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { makeBoxBarcode } from '@/lib/labels/barcode';
import { mergeLabelText, normalizeMergeGroups, type MergeGroups } from '@/lib/box-merge';
import { LABEL_PRESETS, LABEL_TEMPLATE_KEY, buildTemplate, parseElements, type LabelData, type LabelPresetKey, type LabelTemplate } from '@/lib/labels/template';
import { printedBoxTypeValue } from '@/lib/labels/reprint';
import { printableSeqError } from '@/lib/packing/box-rules';
import { unprintedSeqs } from '@/lib/label-status';
import { cancelledCardIds } from '@/lib/card-cancelled';
import { isIsoDate } from '@/lib/validate';
import { missingTable } from '@/lib/supabase/missing-table';
import { LABEL_ACTIVE_DESIGN_KEY, LABEL_MARGIN_KEY, LABEL_ROTATE_KEY, clampLabelMargin, loadCardLabelBase, loadCardLabels, loadLabelConfirmMode, loadLabelDesigns, loadLabelRotate, loadLabelTemplate, loadPendingLabelSeqs, loadSubmittedBoxTypes, type CardLabelBase, type CardLabelInfo, type LabelDesign } from '@/lib/labels/server';
import { LABEL_CONFIRM_KEY, normalizeConfirmMode, type LabelConfirmMode, type PrintJobItem } from '@/lib/labels/print-job';
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
  confirmMode: LabelConfirmMode;
  pendingSeqs: number[]; // 출력 확정 방식이 '스풀러'일 때, 인쇄 완료 확인을 기다리는 박스 순번
}

export async function getCardLabels(dailyBusinessId: string): Promise<CardLabelPreviewSource> {
  await requirePermission('packing:view');
  const supabase = await createClient();
  const [infos, template, base, confirmMode] = await Promise.all([loadCardLabels(supabase, dailyBusinessId), loadLabelTemplate(supabase), loadCardLabelBase(supabase, dailyBusinessId), loadLabelConfirmMode(supabase)]);
  const pendingSeqs = confirmMode === 'spooler' ? await loadPendingLabelSeqs(supabase, dailyBusinessId) : [];
  return { infos, template, base, confirmMode, pendingSeqs };
}

// 라벨 출력 확정 방식 저장(라벨 설정 화면). 'spooler'는 프린터 PC의 에이전트와 마이그레이션 0061이 있어야 의미가 있다.
export async function saveLabelConfirmMode(mode: LabelConfirmMode): Promise<{ error: string | null; mode: LabelConfirmMode }> {
  await requirePermission('labels:edit');
  const value = normalizeConfirmMode(mode);
  const supabase = await createClient();
  const { error } = await supabase.from('app_settings').upsert({ key: LABEL_CONFIRM_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return { error: error.message, mode: value };
  revalidatePath('/labels');
  revalidatePath('/packing-log');
  return { error: null, mode: value };
}

export interface LabelPrintPayload {
  error: string | null;
  template: LabelTemplate | null;
  labels: LabelData[];
  infos: CardLabelInfo[];
  rotated: boolean; // 롤 방향에 맞춰 90도 돌려 출력하는 설정(라벨 설정 화면)
  jobId: string | null; // 스풀러 방식일 때의 출력 작업 id(인쇄 창 제목에 넣는다). 버튼 방식이면 null
  pendingSeqs: number[]; // 스풀러 방식에서 인쇄 완료 확인을 기다리는 박스 순번
}

// 업체 한 곳의 박스 순번(seqs) 라벨을 출력할 준비를 한다: 아직 바코드가 없는 순번에는 바코드를 발급하고, 출력 이력을 남기고, 인쇄할 라벨 값을 돌려준다.
// 한 업체 출력(prepareLabelPrint)과 일괄 출력(prepareBatchLabelPrint)이 같이 쓴다. 같은 박스를 다시 부르면 같은 바코드로 재출력이 된다.
type Supabase = Awaited<ReturnType<typeof createClient>>;
async function prepareCardLabels(
  supabase: Supabase,
  userId: string | null,
  dailyBusinessId: string,
  rawSeqs: number[],
  template: LabelTemplate,
  mode: LabelConfirmMode,
): Promise<{ error: string } | { error: null; labels: LabelData[]; items: PrintJobItem[] }> {
  const seqs = [...new Set(rawSeqs)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 99).sort((a, b) => a - b);
  if (seqs.length === 0) return { error: '출력할 박스를 선택해주세요.' };
  if ((await cancelledCardIds(supabase, [dailyBusinessId])).size > 0) return { error: '주문이 모두 취소된 고객사라 라벨을 출력할 수 없습니다.' };

  const [base, { data: existing }] = await Promise.all([
    loadCardLabelBase(supabase, dailyBusinessId),
    supabase.from('box_labels').select('id, seq, barcode').eq('daily_business_id', dailyBusinessId),
  ]);
  if (!base) return { error: '업체 주문을 찾지 못했습니다.' };

  // 라벨은 제출한 박스에 대해서만 출력한다(제출 전이나 제출한 박스 수보다 큰 번호는 막는다).
  // 제출한 박스 종류도 같이 읽는다: 라벨 N번 = N번째 박스(박스 종류 항목이 있는 디자인이면 라벨에 찍힌다).
  const boxTypes = await loadSubmittedBoxTypes(supabase, dailyBusinessId);
  const seqError = printableSeqError(boxTypes.length, seqs);
  if (seqError) return { error: seqError };

  // 스풀러 방식: 인쇄가 끝났다고 확인되기 전에는 바코드 행도 출력 이력도 만들지 않는다(바코드 번호는 날짜·업체번호·순번으로 정해지므로 미리 계산할 수 있다).
  // 작업(label_print_jobs)에 적어 두면 에이전트가 인쇄 완료를 알릴 때 DB 함수가 이 값으로 행·이력을 만든다.
  if (mode === 'spooler') {
    const barcodeBySeq = new Map((existing ?? []).map((l) => [l.seq, l.barcode]));
    const items: PrintJobItem[] = [];
    try {
      for (const seq of seqs) {
        const barcode = barcodeBySeq.get(seq) ?? makeBoxBarcode(base.orderDate, base.businessNumber, seq);
        items.push({ daily_business_id: dailyBusinessId, seq, barcode, printed_box_type: printedBoxTypeValue(template, boxTypes[seq - 1] ?? '') });
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : '바코드를 만들지 못했습니다.' };
    }
    return { error: null, items, labels: items.map((item) => ({ ...base.data, boxNo: item.seq, barcode: item.barcode, merge: mergeLabelText(base.mergeGroups, item.seq), boxType: boxTypes[item.seq - 1] ?? '' })) };
  }

  const labelBySeq = new Map((existing ?? []).map((l) => [l.seq, l]));
  const missing = seqs.filter((s) => !labelBySeq.has(s));
  if (missing.length > 0) {
    let rows;
    try {
      rows = missing.map((seq) => ({ daily_business_id: dailyBusinessId, seq, barcode: makeBoxBarcode(base.orderDate, base.businessNumber, seq) }));
    } catch (e) {
      return { error: e instanceof Error ? e.message : '바코드를 만들지 못했습니다.' };
    }
    const { data: created, error } = await supabase.from('box_labels').upsert(rows, { onConflict: 'daily_business_id,seq' }).select('id, seq, barcode');
    if (error) return { error: error.message };
    for (const l of created ?? []) labelBySeq.set(l.seq, l);
  }

  const ids = seqs.flatMap((s) => (labelBySeq.get(s) ? [labelBySeq.get(s)!.id] : []));
  if (ids.length !== seqs.length) return { error: '바코드를 발급하지 못한 박스가 있습니다. 다시 시도해주세요.' };

  // 이번에 라벨에 찍히는 박스 종류를 기억해 둔다(나중에 박스 종류가 바뀌면 "재출력 필요"로 알린다). 같은 값끼리 묶어 한 번에 쓴다.
  // 열(0051)이 아직 없으면 건너뛴다 — 그 경우 화면은 재출력 안내만 하지 않는다.
  const idsByPrinted = new Map<string | null, string[]>();
  for (const seq of seqs) {
    const value = printedBoxTypeValue(template, boxTypes[seq - 1] ?? '');
    idsByPrinted.set(value, [...(idsByPrinted.get(value) ?? []), labelBySeq.get(seq)!.id]);
  }
  for (const [value, labelIds] of idsByPrinted) {
    const { error } = await supabase.from('box_labels').update({ printed_box_type: value }).in('id', labelIds);
    if (error && missingTable(error.message) !== 'label_printed_box_type') return { error: error.message };
  }
  await supabase.from('box_label_events').insert(ids.map((label_id) => ({ label_id, event: 'print' as const, label_kind: LABEL_TEMPLATE_KEY, created_by: userId })));

  return { error: null, items: [], labels: seqs.map((seq) => ({ ...base.data, boxNo: seq, barcode: labelBySeq.get(seq)!.barcode, merge: mergeLabelText(base.mergeGroups, seq), boxType: boxTypes[seq - 1] ?? '' })) };
}

// 스풀러 방식의 출력 작업을 만든다. 인쇄 창의 문서 제목에 이 id를 넣어 인쇄하고, 에이전트가 인쇄 완료 이벤트에서 id를 읽어 확정한다.
async function createPrintJob(supabase: Supabase, userId: string | null, items: PrintJobItem[]): Promise<{ error: string } | { error: null; jobId: string }> {
  const { data, error } = await supabase.from('label_print_jobs').insert({ items, label_kind: LABEL_TEMPLATE_KEY, created_by: userId }).select('id').single();
  if (error) {
    if (missingTable(error.message) === 'label_print_jobs') return { error: '출력 확정 방식이 "스풀러"인데 마이그레이션 0061_label_print_spooler.sql이 적용되지 않았습니다. 적용하거나 라벨 설정에서 "버튼" 방식으로 바꿔 주세요.' };
    return { error: error.message };
  }
  return { error: null, jobId: data.id };
}

export async function prepareLabelPrint(input: { dailyBusinessId: string; seqs: number[] }): Promise<LabelPrintPayload> {
  const access = await requirePermission('packing:print');
  const fail = (error: string): LabelPrintPayload => ({ error, template: null, labels: [], infos: [], rotated: false, jobId: null, pendingSeqs: [] });
  const supabase = await createClient();
  const userId = access.userId;
  const [template, rotated, mode] = await Promise.all([loadLabelTemplate(supabase), loadLabelRotate(supabase), loadLabelConfirmMode(supabase)]);
  const result = await prepareCardLabels(supabase, userId, input.dailyBusinessId, input.seqs, template, mode);
  if (result.error !== null) return fail(result.error);
  let jobId: string | null = null;
  if (mode === 'spooler') {
    const job = await createPrintJob(supabase, userId, result.items);
    if (job.error !== null) return fail(job.error);
    jobId = job.jobId;
  }
  revalidatePath('/packing-log');
  const pendingSeqs = mode === 'spooler' ? await loadPendingLabelSeqs(supabase, input.dailyBusinessId) : [];
  return { error: null, template, labels: result.labels, infos: await loadCardLabels(supabase, input.dailyBusinessId), rotated, jobId, pendingSeqs };
}

export interface BatchLabelPayload {
  error: string | null;
  template: LabelTemplate | null;
  labels: LabelData[];
  rotated: boolean;
  jobId: string | null; // 스풀러 방식일 때의 출력 작업 id(버튼 방식이면 null)
  businesses: number; // 라벨을 낸 업체 수
  skipped: string[]; // 준비하지 못한 업체 이름(이유 포함)
}

const BATCH_CONCURRENCY = 4;

// 날짜의 제출한 업체(택배 제외) 중 아직 한 번도 출력하지 않은 라벨을 업체 번호순으로 모아 한 번에 출력할 준비를 한다.
// 확정 방식이 '버튼'이면 업체마다 바코드를 발급하고 출력 이력을 바로 남기므로, 인쇄 대화상자를 닫거나 취소해도 "출력함"으로 기록된다(업체별 출력과 같다).
// '스풀러'면 인쇄 완료가 확인된 라벨만 기록되고, 확인을 기다리는 라벨은 이 일괄 출력에서 빠진다.
export async function prepareBatchLabelPrint(orderDate: string): Promise<BatchLabelPayload> {
  const access = await requirePermission('packing:print');
  const fail = (error: string): BatchLabelPayload => ({ error, template: null, labels: [], rotated: false, jobId: null, businesses: 0, skipped: [] });
  if (!isIsoDate(orderDate)) return fail('날짜 형식이 올바르지 않습니다.');
  const supabase = await createClient();
  const userId = access.userId;

  const { data: dailies, error: dailyError } = await supabase
    .from('daily_businesses')
    .select('id, business_id, business_number, display_name, terminal_id')
    .eq('order_date', orderDate)
    .order('business_number');
  if (dailyError) return fail(dailyError.message);
  const businessIds = [...new Set((dailies ?? []).map((d) => d.business_id))];
  const [{ data: terminals }, { data: businessRows }, { data: records }, template, rotated, mode] = await Promise.all([
    supabase.from('terminals').select('id, is_parcel'),
    businessIds.length ? supabase.from('businesses').select('id, name').in('id', businessIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from('packing_records').select('id, daily_business_id').eq('order_date', orderDate),
    loadLabelTemplate(supabase),
    loadLabelRotate(supabase),
    loadLabelConfirmMode(supabase),
  ]);
  const businessName = new Map((businessRows ?? []).map((b) => [b.id, b.name]));
  const parcel = new Set((terminals ?? []).filter((t) => t.is_parcel).map((t) => t.id));
  const submitted = new Set((records ?? []).map((r) => r.daily_business_id));
  // 주문이 모두 취소된 고객사는 라벨이 필요 없다.
  const cancelled = await cancelledCardIds(supabase, (dailies ?? []).map((d) => d.id));
  const targets = (dailies ?? []).filter((d) => submitted.has(d.id) && !cancelled.has(d.id) && !(d.terminal_id && parcel.has(d.terminal_id)));

  const perBusiness: { order: number; name: string; labels: LabelData[]; items: PrintJobItem[]; error: string | null }[] = [];
  for (let i = 0; i < targets.length; i += BATCH_CONCURRENCY) {
    const chunk = targets.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (d, k) => {
        const name = d.display_name ?? businessName.get(d.business_id) ?? `업체 ${d.business_number}번`;
        const [infos, boxTypes] = await Promise.all([loadCardLabels(supabase, d.id), loadSubmittedBoxTypes(supabase, d.id)]);
        // 스풀러 방식에서는 인쇄 완료 확인을 기다리는 박스도 뺀다(같은 라벨이 두 번 나가지 않게).
        const pending = mode === 'spooler' ? await loadPendingLabelSeqs(supabase, d.id) : [];
        const seqs = unprintedSeqs(boxTypes.length, [...infos.filter((l) => l.printCount > 0).map((l) => l.seq), ...pending]);
        if (seqs.length === 0) return { order: i + k, name, labels: [] as LabelData[], items: [] as PrintJobItem[], error: null };
        const result = await prepareCardLabels(supabase, userId, d.id, seqs, template, mode);
        return result.error === null ? { order: i + k, name, labels: result.labels, items: result.items, error: null } : { order: i + k, name, labels: [] as LabelData[], items: [] as PrintJobItem[], error: result.error };
      }),
    );
    perBusiness.push(...results);
  }
  perBusiness.sort((a, b) => a.order - b.order);
  const labels = perBusiness.flatMap((b) => b.labels);
  if (labels.length === 0 && perBusiness.every((b) => !b.error)) return fail('아직 출력하지 않은 라벨이 없습니다.');
  // 한 번의 인쇄 = 인쇄 작업 하나: 업체별 라벨을 인쇄하는 순서 그대로 한 작업에 담는다(labels와 items의 순서가 같다).
  let jobId: string | null = null;
  if (mode === 'spooler' && labels.length > 0) {
    const job = await createPrintJob(supabase, userId, perBusiness.flatMap((b) => b.items));
    if (job.error !== null) return fail(job.error);
    jobId = job.jobId;
  }
  revalidatePath('/packing-log');
  return {
    error: null,
    template,
    labels,
    rotated,
    jobId,
    businesses: perBusiness.filter((b) => b.labels.length > 0).length,
    skipped: perBusiness.filter((b) => b.error).map((b) => `${b.name}: ${b.error}`),
  };
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
