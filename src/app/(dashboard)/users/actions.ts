'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { MASTER_EMAIL, normalizePermissions } from '@/lib/permissions/catalog';
import { PermissionError, getAccess } from '@/lib/permissions/access';

// 사용자·권한 관리는 master 계정만 할 수 있다. 화면 접근과 별개로 모든 동작에서 다시 확인한다.
async function requireMasterAccess() {
  const access = await getAccess();
  if (!access?.isMaster) throw new PermissionError();
  return access;
}

const MIN_PASSWORD_LENGTH = 8;

export async function createUser(input: { email: string; password: string; displayName: string }): Promise<{ error: string | null }> {
  await requireMasterAccess();
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '이메일 형식이 올바르지 않습니다.' };
  if (input.password.length < MIN_PASSWORD_LENGTH) return { error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };

  const admin = createAdminClient();
  // 이메일 인증 없이 바로 쓸 수 있게 만든다(master가 직접 등록하는 계정이다). 이름은 profiles의 표시 이름이 된다.
  const { data, error } = await admin.auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: { display_name: displayName || email.split('@')[0] } });
  if (error || !data.user) return { error: error?.message.includes('already') ? '이미 등록된 이메일입니다.' : (error?.message ?? '사용자를 만들지 못했습니다.') };
  // 새 사용자는 아무 권한도 없는 상태로 시작한다.
  const { error: permError } = await admin.from('user_permissions').upsert({ user_id: data.user.id, permissions: [] });
  if (permError) return { error: `사용자는 만들었지만 권한 행을 만들지 못했습니다(마이그레이션 0031 적용 필요): ${permError.message}` };
  revalidatePath('/users');
  return { error: null };
}

export async function savePermissions(userId: string, keys: string[]): Promise<{ error: string | null; saved: string[] }> {
  await requireMasterAccess();
  const admin = createAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(userId);
  if (!target.user) return { error: '사용자를 찾지 못했습니다.', saved: [] };
  if (target.user.email?.toLowerCase() === MASTER_EMAIL) return { error: '최고 권한자 계정의 권한은 바꿀 수 없습니다.', saved: [] };
  const saved = normalizePermissions(keys);
  const { error } = await admin.from('user_permissions').upsert({ user_id: userId, permissions: saved, updated_at: new Date().toISOString() });
  if (error) return { error: error.message, saved: [] };
  revalidatePath('/users');
  return { error: null, saved };
}

export async function deleteUser(userId: string): Promise<{ error: string | null }> {
  const me = await requireMasterAccess();
  if (userId === me.userId) return { error: '로그인한 본인 계정은 삭제할 수 없습니다.' };
  const admin = createAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(userId);
  if (!target.user) return { error: '사용자를 찾지 못했습니다.' };
  if (target.user.email?.toLowerCase() === MASTER_EMAIL) return { error: '최고 권한자 계정은 삭제할 수 없습니다.' };
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };
  revalidatePath('/users');
  return { error: null };
}
