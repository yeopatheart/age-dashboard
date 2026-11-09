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

// 파괴 동작(주문 취소 등) 직후에 "되돌리기" 버튼을 같이 보여 주는 안내. 확인창(confirm)과 달리 화면을 멈추지 않으므로
// 실시간 갱신·소리가 있는 칠판 PC에서도 쓸 수 있고, 한 번 눌러 바로 취소하는 흐름을 유지한다.
export function useUndoToast(ms = 10000): [React.ReactNode, (message: string, onUndo: () => void | Promise<void>) => void] {
  const [state, setState] = useState<{ message: string; onUndo: () => void | Promise<void> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback(
    (message: string, onUndo: () => void | Promise<void>) => {
      clearTimeout(timer.current);
      setState({ message, onUndo });
      timer.current = setTimeout(() => setState(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = state ? (
    <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex max-w-[92vw] items-center gap-3 rounded-xl bg-slate-800 py-1.5 pl-4 pr-1.5 text-sm font-bold text-white shadow-lg">
      <span>{state.message}</span>
      <button
        type="button"
        className="rounded-lg bg-white px-3 py-1 text-slate-900 hover:bg-slate-100"
        onClick={() => {
          clearTimeout(timer.current);
          const undo = state.onUndo;
          setState(null);
          void undo();
        }}
      >
        되돌리기
      </button>
    </div>
  ) : null;
  return [node, show];
}
