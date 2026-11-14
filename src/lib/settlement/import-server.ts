// 정산 엑셀 가져오기가 견줄 "지금 DB 값"(서버 전용). 정산 화면(page.tsx)이 같은 날짜에 읽는 값과 같은 방식으로 읽는다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { valueOrMissing } from '@/lib/supabase/missing-table';
import { loadSalesAndCards, loadShippingRows, loadSupplierDirectory } from './server';
import type { ImportContext } from './excel-import';

export async function loadImportContext(supabase: SupabaseClient<Database>, date: string): Promise<ImportContext> {
  const [{ rows: sales, doneCards, cardSettingsAvailable, purchaseAvailable, prices }, sellers, directory] = await Promise.all([
    loadSalesAndCards(supabase, date, date),
    fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: '),
    valueOrMissing(loadSupplierDirectory(supabase)),
  ]);
  const shipping = await valueOrMissing(loadShippingRows(supabase, doneCards, sales));
  return {
    date,
    sales,
    shipping: shipping.value,
    sellers,
    suppliers: directory.value?.suppliers ?? [],
    prices: purchaseAvailable ? new Map(prices.map((p) => [p.product, { saleUnitPrice: p.saleUnitPrice, supplierId: p.supplierId, purchaseUnitPrice: p.purchaseUnitPrice }])) : null,
    cardSettingsAvailable,
  };
}
