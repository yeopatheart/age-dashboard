import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { MASTER_EMAIL, MENU_DEFS, MENU_KEYS, type MenuKey, type PermissionKey } from './catalog';

export interface Access {
  userId: string;
  email: string;
  isMaster: boolean;
  permissions: Set<string>;
}

// 현재 로그인한 사용자의 권한. 한 요청 안에서는 한 번만 읽는다(layout과 page가 같이 불러도 DB는 한 번).
// master는 DB를 읽지 않고 이메일로 판단한다 — 권한 표나 마이그레이션에 문제가 있어도 master는 항상 들어올 수 있어야 한다.
export const getAccess = cache(async (): Promise<Access | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (email === MASTER_EMAIL) return { userId: claims.sub, email, isMaster: true, permissions: new Set() };
  const { data: row } = await supabase.from('user_permissions').select('permissions').eq('user_id', claims.sub).maybeSingle();
  return { userId: claims.sub, email, isMaster: false, permissions: new Set(row?.permissions ?? []) };
});

export function can(access: Access | null, key: PermissionKey): boolean {
  return !!access && (access.isMaster || access.permissions.has(key));
}

export function firstAllowedHref(access: Access | null): string | null {
  const menu = MENU_KEYS.find((m) => can(access, `${m}:view` as PermissionKey));
  if (menu) return MENU_DEFS[menu].href;
  return access?.isMaster ? '/users' : null;
}

// page.tsx 맨 위에서 부른다: 메뉴를 열 권한이 없으면 열 수 있는 첫 메뉴로 보낸다.
export async function requireMenu(menu: MenuKey): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect('/login');
  if (!can(access, `${menu}:view` as PermissionKey)) redirect(firstAllowedHref(access) ?? '/no-access');
  return access;
}

export async function requireMaster(): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect('/login');
  if (!access.isMaster) redirect(firstAllowedHref(access) ?? '/no-access');
  return access;
}

export class PermissionError extends Error {
  constructor() {
    super('이 작업을 할 권한이 없습니다.');
  }
}

// server action 맨 위에서 부른다. 화면에서 버튼을 숨겨도 서버가 다시 확인해야 한다(주소·요청을 직접 만들어 호출할 수 있다).
export async function requirePermission(key: PermissionKey): Promise<Access> {
  const access = await getAccess();
  if (!can(access, key)) throw new PermissionError();
  return access!;
}
