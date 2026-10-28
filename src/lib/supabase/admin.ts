import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

// 사용자 등록·삭제와 권한 저장에만 쓰는 서버 전용 클라이언트. SUPABASE_SERVICE_ROLE_KEY는 RLS를 건너뛰는 키라서
// NEXT_PUBLIC_ 접두사를 붙이지 않고(브라우저로 나가지 않게), 이 파일은 서버 코드(server action, page)에서만 가져온다.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. .env와 Vercel 환경변수에 추가하세요.');
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
