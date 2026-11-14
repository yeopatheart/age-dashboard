'use client';
import { useSyncExternalStore } from 'react';

// 브라우저에서 하이드레이션이 끝났는지. 서버 렌더와 첫 렌더는 false이고 그 뒤 true가 된다.
// 렌더 중 window·localStorage를 읽는 컴포넌트(펜 그림 층)는 서버에서 그리면 오류가 나므로 이 값이 true일 때만 그린다.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
