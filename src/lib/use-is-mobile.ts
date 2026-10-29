'use client';
import { useSyncExternalStore } from 'react';

// 휴대폰 폭(768px 이하) 여부. 서버 렌더는 false로 그리고 하이드레이션 뒤에 실제 폭으로 바뀐다(서버가 기기를 알면 initial로 넘긴다).
const QUERY = '(max-width: 768px)';
export function useIsMobile(initial = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => initial,
  );
}
