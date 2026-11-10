// 보내기 기록 조회(서버 전용). 순수 로직은 dispatch-log.ts. 마이그레이션 0052 전에는 테이블이 없어 rowsOrMissing으로 부른다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { fetchAll } from '@/lib/supabase/fetch-all';
import type { DispatchLogRow } from './dispatch-log';

// 출고일이 orderDate인 기록 전부(같은 항목의 옛 기록 포함). 항목별 최근 것만 고르는 일은 latestByKey가 한다.
export async function loadDispatchLog(supabase: SupabaseClient<Database>, orderDate: string): Promise<DispatchLogRow[]> {
  const rows = await fetchAll(
    (a, b) =>
      supabase
        .from('dispatch_log')
        .select('id, kind, key, method, content_hash, sent_at')
        .eq('order_date', orderDate)
        .order('sent_at', { ascending: false })
        .order('id')
        .range(a, b),
    '보내기 기록 조회 실패(마이그레이션 0052 적용 필요): ',
  );
  return rows.map((r) => ({ kind: r.kind, key: r.key, method: r.method, contentHash: r.content_hash, sentAt: r.sent_at }));
}
