'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// 화면 위쪽에 잠깐 뜨는 오류 안내. window.alert를 대신한다 — alert는 화면이 닫을 때까지 멈춰서, 아무도 없는 칠판 TV에서는
// 실시간 갱신과 소리가 그대로 멈추고 휴대폰 홈 화면 앱에서도 투박하다.
export function useToast(ms = 6000): [React.ReactNode, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback(
    (next: string) => {
      clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = message ? (
    <div role="alert" className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-lg" onClick={() => setMessage(null)}>
      {message}
    </div>
  ) : null;
  return [node, show];
}
