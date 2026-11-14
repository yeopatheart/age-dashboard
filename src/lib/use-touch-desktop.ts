'use client';
import { useSyncExternalStore } from 'react';
import { isTouchDesktop } from './touch-device';

// 펜 버튼을 보일 기기인지(터치 입력이 있는 데스크톱 화면 = 스마트 칠판). 서버 렌더는 항상 false이고 하이드레이션 뒤에 실제 값으로 바뀐다
// (펜 층은 렌더 중 window를 읽으므로 서버에서 그리면 안 된다). override가 '1'이면 강제로 보이고 '0'이면 숨긴다(기기 판별이 틀렸을 때 주소로 쓰는 우회).
export function useTouchDesktop(override: string | null = null): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    () => {
      if (override === '1') return true;
      if (override === '0') return false;
      return isTouchDesktop({ maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent, width: window.innerWidth, platform: navigator.platform });
    },
    () => false,
  );
}
