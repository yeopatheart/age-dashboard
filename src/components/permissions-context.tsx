'use client';
import { createContext, useContext } from 'react';
import type { PermissionKey } from '@/lib/permissions/catalog';

// 현재 사용자가 가진 권한(서버에서 계산해서 layout이 내려준다). 화면에서 버튼을 숨기는 용도다 —
// 실제 차단은 서버(page의 requireMenu, server action의 requirePermission)가 한다.
const Ctx = createContext<{ isMaster: boolean; keys: ReadonlySet<string> }>({ isMaster: false, keys: new Set() });

export function PermissionsProvider({ isMaster, keys, children }: { isMaster: boolean; keys: string[]; children: React.ReactNode }) {
  return <Ctx.Provider value={{ isMaster, keys: new Set(keys) }}>{children}</Ctx.Provider>;
}

export function useCan() {
  const { isMaster, keys } = useContext(Ctx);
  return (key: PermissionKey) => isMaster || keys.has(key);
}
