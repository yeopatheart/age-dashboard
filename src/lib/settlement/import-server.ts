// 정산 엑셀 가져오기가 견줄 "지금 DB 값"(서버 전용). 정산 화면(page.tsx)이 같은 날짜에 읽는 값과 같은 방식으로 읽는다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { rowsOrMissing, valueOrMissing } from '@/lib/supabase/missing-table';
import { loadSalesAndCards, loadShippingRows, loadStoredPurchases, loadSupplierDirectory } from './server';
import { buildPurchaseRows } from './purchases';
import type { ImportContext } from './excel-import';

export async function loadImportContext(supabase: SupabaseClient<Database>, date: string): Promise<ImportContext> {
  const [{ rows: sales, doneCards }, sellers, stored, directory] = await Promise.all([
    loadSalesAndCards(supabase, date, date),
    fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: '),
    rowsOrMissing(loadStoredPurchases(supabase, date, date)),
    valueOrMissing(loadSupplierDirectory(supabase)),
  ]);
  const shipping = await valueOrMissing(loadShippingRows(supabase, doneCards, sales));
  const purchasesAvailable = !stored.missing && !directory.missing && directory.value;
  return {
    date,
    sales,
    shipping: shipping.value,
    purchases: purchasesAvailable ? buildPurchaseRows(sales, stored.rows) : null,
    sellers,
    suppliers: directory.value?.suppliers ?? [],
  };
}
