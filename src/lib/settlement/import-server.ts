// 정산 엑셀 가져오기가 견줄 "지금 DB 값"(서버 전용). 정산 화면(page.tsx)이 같은 날짜에 읽는 값과 같은 방식으로 읽는다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { valueOrMissing } from '@/lib/supabase/missing-table';
import { loadSalesAndCards, loadShippingRows } from './server';
import type { ImportContext } from './excel-import';

export async function loadImportContext(supabase: SupabaseClient<Database>, date: string): Promise<ImportContext> {
  const { rows: sales, doneCards } = await loadSalesAndCards(supabase, date, date);
  const shipping = await valueOrMissing(loadShippingRows(supabase, doneCards, sales));
  return { date, sales, shipping: shipping.value };
}
