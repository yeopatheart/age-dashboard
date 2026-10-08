import { createClient } from '@/lib/supabase/server';
import { DashboardShell } from './dashboard-shell';

// 로그인 여부 자체는 src/proxy.ts가 게이트한다 — 여기서는 사이드바에 보여줄 표시 이름만 조회한다.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  let displayName = '사용자';
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();
    if (profile?.display_name) displayName = profile.display_name;
  }

  return <DashboardShell displayName={displayName}>{children}</DashboardShell>;
}
