import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isTransientAuthError } from '@/lib/supabase/auth-errors';
import { MASTER_EMAIL, MENU_DEFS, MENU_KEYS, type MenuKey, type PermissionKey } from './catalog';

export interface Access {
  userId: string;
  email: string;
  isMaster: boolean;
  permissions: Set<string>;
}

// 인증 서버에 잠깐 닿지 못해 로그인 여부를 확인하지 못했다(로그인이 풀린 것이 아니다). 로그인 화면으로 보내지 않고 이 오류를 던져
// "화면을 불러오지 못했습니다" 안내((dashboard)/error.tsx)가 스스로 다시 시도하게 한다.
export class AuthUnavailableError extends Error {
  constructor() {
    super('로그인 확인이 잠시 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
  }
}

const AUTH_RETRY_DELAY_MS = 300;

// 현재 로그인한 사용자의 권한과, 확인 자체를 못 했는지(unavailable). 한 요청 안에서는 한 번만 읽는다(layout과 page가 같이 불러도 DB는 한 번).
// master는 DB를 읽지 않고 이메일로 판단한다 — 권한 표나 마이그레이션에 문제가 있어도 master는 항상 들어올 수 있어야 한다.
// 일시적 오류(네트워크·Auth 서버 지연)면 한 번 더 시도하고, 그래도 안 되면 unavailable로 알린다 — "로그인 안 됨"과 섞지 않는다.
const getAccessState = cache(async (): Promise<{ access: Access | null; unavailable: boolean }> => {
  const supabase = await createClient();
  let result = await supabase.auth.getClaims();
  if (!result.data?.claims && isTransientAuthError(result.error)) {
    await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));
    result = await supabase.auth.getClaims();
  }
  const claims = result.data?.claims;
  if (!claims?.sub) return { access: null, unavailable: isTransientAuthError(result.error) };
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (email === MASTER_EMAIL) return { access: { userId: claims.sub, email, isMaster: true, permissions: new Set() }, unavailable: false };
  const { data: row } = await supabase.from('user_permissions').select('permissions').eq('user_id', claims.sub).maybeSingle();
  return { access: { userId: claims.sub, email, isMaster: false, permissions: new Set(row?.permissions ?? []) }, unavailable: false };
});

// 권한만 필요한 곳(레이아웃의 메뉴 표시 등). 확인을 못 했으면 null이다 — 화면을 막는 판단은 아래 require* 함수가 한다.
export async function getAccess(): Promise<Access | null> {
  return (await getAccessState()).access;
}

// 로그인이 필요한 곳에서 쓴다: 확인을 못 한 것이면 AuthUnavailableError, 로그인이 안 된 것이면 null.
export async function accessOrUnavailable(): Promise<Access | null> {
  const { access, unavailable } = await getAccessState();
  if (unavailable) throw new AuthUnavailableError();
  return access;
}

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
  const access = await accessOrUnavailable();
  if (!access) redirect('/login');
  if (!can(access, `${menu}:view` as PermissionKey)) redirect(firstAllowedHref(access) ?? '/no-access');
  return access;
}

export async function requireMaster(): Promise<Access> {
  const access = await accessOrUnavailable();
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
  const access = await accessOrUnavailable();
  if (!can(access, key)) throw new PermissionError();
  return access!;
}
