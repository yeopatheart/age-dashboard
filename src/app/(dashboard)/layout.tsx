import { createClient } from '@/lib/supabase/server';
import { getAccess } from '@/lib/permissions/access';
import { PermissionsProvider } from '@/components/permissions-context';
import { DashboardShell } from './dashboard-shell';

// 로그인 여부 자체는 src/proxy.ts가 게이트한다 — 여기서는 사이드바에 보여줄 표시 이름과 메뉴 권한만 조회한다.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const access = await getAccess();
  const userId = access?.userId;

  let displayName = '사용자';
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();
    if (profile?.display_name) displayName = profile.display_name;
  }

  const keys = access ? [...access.permissions] : [];
  return (
    <PermissionsProvider isMaster={access?.isMaster ?? false} keys={keys}>
      <DashboardShell displayName={displayName} allowedMenus={keys.filter((k) => k.endsWith(':view')).map((k) => k.split(':')[0])} isMaster={access?.isMaster ?? false}>
        {children}
      </DashboardShell>
    </PermissionsProvider>
  );
}
