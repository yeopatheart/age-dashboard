'use client';
import { useSyncExternalStore } from 'react';

// 브라우저(localStorage)에 저장하는 on/off 값. 이 브라우저마다 따로 기억하고 서버에는 저장하지 않는다.
// useSyncExternalStore라서 서버 렌더는 항상 false로 그리고, 하이드레이션 뒤에 저장된 값으로 바뀐다(이펙트 안 setState 없음).
const listeners = new Map<string, Set<() => void>>();

export function useLocalFlag(key: string): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(cb);
      window.addEventListener('storage', cb);
      return () => {
        set.delete(cb);
        window.removeEventListener('storage', cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false; // localStorage가 막혀 있으면(시크릿 모드 등) 기본값
      }
    },
    () => false,
  );
  const set = (next: boolean) => {
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // 저장이 막혀 있으면 저장 없이 이번 화면에서만 바뀐다
    }
    listeners.get(key)?.forEach((l) => l());
  };
  return [value, set];
}
