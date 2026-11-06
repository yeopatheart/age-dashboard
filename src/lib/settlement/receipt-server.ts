// 발행한 영수증 이력 조회(서버 전용). 스냅샷 모양은 receipt.ts의 ReceiptSnapshot이고, 읽을 수 없는 값은 snapshot을 null로 돌려준다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { parseSnapshot, type ReceiptSnapshot } from './receipt';

export interface ReceiptRecord {
  id: string;
  receiptNo: number;
  orderDate: string;
  customerName: string;
  sellerId: string | null;
  total: number;
  createdAt: string;
  snapshot: ReceiptSnapshot | null; // 모양이 맞지 않으면 null(화면이 "열 수 없음"으로 보여 준다)
}

// 출고일이 from~to인 발행 이력을 최근 것부터 돌려준다.
export async function loadReceipts(supabase: SupabaseClient<Database>, from: string, to: string): Promise<ReceiptRecord[]> {
  const rows = await fetchAll(
    (a, b) =>
      supabase
        .from('settlement_receipts')
        .select('id, receipt_no, order_date, customer_name, seller_id, total, snapshot, created_at')
        .gte('order_date', from)
        .lte('order_date', to)
        .order('order_date', { ascending: false })
        .order('receipt_no', { ascending: false })
        .order('id')
        .range(a, b),
    '영수증 이력 조회 실패(마이그레이션 0047 적용 필요): ',
  );
  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receipt_no,
    orderDate: r.order_date,
    customerName: r.customer_name,
    sellerId: r.seller_id,
    total: Number(r.total),
    createdAt: r.created_at,
    snapshot: parseSnapshot(r.snapshot),
  }));
}
