'use server';

import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/access';
import { todayKST } from '@/lib/order-date';
import type { DispatchKind, DispatchMethod } from '@/lib/dispatch-log';

// 글·영수증을 공유/복사한 순간을 남긴다. 사용자(sent_by)는 DB가 로그인 사용자로 채우고 클라이언트가 보낸 값은 쓰지 않는다.
// 기사 글은 scan:view, 영수증은 receipts:view 권한을 서버가 다시 확인한다(DB 정책도 같은 권한). 기록은 바꾸거나 지우지 않는다.
// 화면은 응답으로 받은 시각을 그대로 쓰므로 revalidatePath를 부르지 않는다(이중 렌더 방지).
export async function recordSent(input: {
  orderDate: string;
  kind: DispatchKind;
  key: string;
  method: DispatchMethod;
  contentHash: string | null;
}): Promise<{ error: string | null; sentAt: string | null }> {
  const { orderDate, kind, key, method, contentHash } = input;
  if (kind !== 'driver' && kind !== 'receipt') return { error: '알 수 없는 보내기 종류입니다.', sentAt: null };
  if (method !== 'share' && method !== 'copy') return { error: '알 수 없는 보내기 방식입니다.', sentAt: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || orderDate > todayKST()) return { error: '날짜가 올바르지 않습니다.', sentAt: null };
  if (typeof key !== 'string' || key.length < 1 || key.length > 100) return { error: '보낸 항목을 알 수 없습니다.', sentAt: null };
  if (contentHash !== null && (typeof contentHash !== 'string' || !/^[0-9a-f]{1,64}$/.test(contentHash))) return { error: '글 해시가 올바르지 않습니다.', sentAt: null };

  await requirePermission(kind === 'driver' ? 'scan:view' : 'receipts:view');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dispatch_log')
    .insert({ order_date: orderDate, kind, key, method, content_hash: contentHash })
    .select('sent_at')
    .single();
  if (error) return { error: error.message, sentAt: null };
  return { error: null, sentAt: data.sent_at };
}
