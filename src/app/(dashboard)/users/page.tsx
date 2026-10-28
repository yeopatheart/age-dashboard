import { requireMaster } from '@/lib/permissions/access';
import { createAdminClient } from '@/lib/supabase/admin';
import { MASTER_EMAIL } from '@/lib/permissions/catalog';
import { UsersClient, type UserRow } from './users-client';

export default async function UsersPage() {
  const me = await requireMaster();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <UsersClient users={[]} meId={me.userId} setupError="SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. .env(로컬)와 Vercel 환경변수에 추가한 뒤 다시 배포하세요." />;
  }
  const admin = createAdminClient();
  const [{ data: list, error }, { data: perms, error: permError }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    admin.from('user_permissions').select('user_id, permissions'),
    admin.from('profiles').select('id, display_name'),
  ]);
  const permsById = new Map((perms ?? []).map((p) => [p.user_id, p.permissions]));
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  const users: UserRow[] = (list?.users ?? [])
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      displayName: nameById.get(u.id) ?? '',
      isMaster: (u.email ?? '').toLowerCase() === MASTER_EMAIL,
      lastSignInAt: u.last_sign_in_at ?? null,
      permissions: permsById.get(u.id) ?? [],
    }))
    .sort((a, b) => Number(b.isMaster) - Number(a.isMaster) || a.email.localeCompare(b.email));
  const setupError = error?.message ?? (permError ? `권한 표를 읽지 못했습니다(마이그레이션 0031 적용 필요): ${permError.message}` : null);
  return <UsersClient users={users} meId={me.userId} setupError={setupError} />;
}
