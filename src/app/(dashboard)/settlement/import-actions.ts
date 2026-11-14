'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { isIsoDate } from '@/lib/validate';
import { planChangeCount, planImport, type Cell, type ImportPlan, type ParsedWorkbook, type RawRow } from '@/lib/settlement/excel-import';
import { loadImportContext } from '@/lib/settlement/import-server';
import { upsertSalesChanges, upsertShippingRows } from '@/lib/settlement/write';

const MAX_CELL_LEN = 600;
const MAX_ROWS = 5000;

// 화면이 보낸 값은 믿지 않고 모양을 다시 확인한다(잘못된 모양이면 null).
function sanitizeRows(value: unknown): RawRow[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_ROWS) return undefined;
  const rows: RawRow[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const r = raw as { row?: unknown; cells?: unknown };
    if (typeof r.row !== 'number' || !Number.isInteger(r.row) || typeof r.cells !== 'object' || r.cells === null) return undefined;
    const cells: Record<string, Cell> = {};
    for (const [k, v] of Object.entries(r.cells as Record<string, unknown>)) {
      if (k.length > 40) return undefined;
      if (v === null || v === undefined) cells[k] = null;
      else if (typeof v === 'number' && Number.isFinite(v)) cells[k] = v;
      else if (typeof v === 'string' && v.length <= MAX_CELL_LEN) cells[k] = v;
      else return undefined;
    }
    rows.push({ row: r.row, cells });
  }
  return rows;
}

function sanitizeWorkbook(value: unknown): ParsedWorkbook | null {
  if (typeof value !== 'object' || value === null) return null;
  const w = value as Record<string, unknown>;
  const sales = sanitizeRows(w.sales ?? null);
  const shipping = sanitizeRows(w.shipping ?? null);
  if (sales === undefined || shipping === undefined) return null;
  const date = typeof w.date === 'string' && isIsoDate(w.date) ? w.date : null;
  return { date, sales, shipping };
}

export type PreviewResult = { error: string; plan?: undefined } | { error: null; plan: ImportPlan };

// 가져올 파일을 지금 DB 값과 견주어 변경 목록과 오류를 보여 준다(아무것도 저장하지 않는다).
export async function previewSettlementImport(date: string, workbook: unknown): Promise<PreviewResult> {
  await requirePermission('settlement:edit');
  const parsed = sanitizeWorkbook(workbook);
  if (!isIsoDate(date) || !parsed) return { error: '파일 내용을 읽지 못했습니다. 이 화면에서 내보낸 파일인지 확인해주세요.' };
  const supabase = await createClient();
  const plan = planImport(await loadImportContext(supabase, date), parsed);
  return { error: null, plan };
}

export type ApplyResult = { error: string | null; applied: { sales: number; shipping: number } };

// 변경을 저장한다. 서버가 DB를 다시 읽어 계획을 새로 만들므로(미리보기 값을 믿지 않는다) 그 사이 주문이 바뀌었으면 그 기준으로 다시 견준다.
// 오류가 하나라도 있으면 아무것도 저장하지 않는다. 삭제는 하지 않는다. 시트마다 따로 저장하므로 중간에 실패하면 이미 저장한 시트는 그대로이고,
// 같은 파일을 다시 가져오면 이미 반영된 칸은 변경 없음으로 건너뛰고 남은 것만 저장한다.
export async function applySettlementImport(date: string, workbook: unknown): Promise<ApplyResult> {
  await requirePermission('settlement:edit');
  const none = { sales: 0, shipping: 0 };
  const parsed = sanitizeWorkbook(workbook);
  if (!isIsoDate(date) || !parsed) return { error: '파일 내용을 읽지 못했습니다. 이 화면에서 내보낸 파일인지 확인해주세요.', applied: none };
  const supabase = await createClient();
  const plan = planImport(await loadImportContext(supabase, date), parsed);
  if (plan.errors.length > 0) return { error: `오류 ${plan.errors.length}건이 있어 아무것도 저장하지 않았습니다. 파일을 고친 뒤 다시 가져와주세요.`, applied: none };
  if (planChangeCount(plan) === 0) return { error: null, applied: none };

  const applied = { ...none };
  const steps: { name: string; count: number; run: () => Promise<{ error: string | null }>; done: () => void }[] = [
    { name: '판매', count: plan.sales.length, run: () => upsertSalesChanges(supabase, plan.sales), done: () => (applied.sales = plan.sales.length) },
    { name: '배송비', count: plan.shipping.length, run: () => upsertShippingRows(supabase, plan.shipping.map((c) => c.input)), done: () => (applied.shipping = plan.shipping.length) },
  ];
  for (const step of steps) {
    if (step.count === 0) continue;
    const result = await step.run();
    if (result.error) {
      revalidatePath('/settlement');
      return { error: `${step.name} 시트를 저장하지 못했습니다: ${result.error} (앞서 저장한 시트는 반영되었습니다. 같은 파일을 다시 가져오면 남은 것만 저장합니다.)`, applied };
    }
    step.done();
  }
  revalidatePath('/settlement');
  return { error: null, applied };
}
