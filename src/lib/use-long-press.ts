'use client';
import { useCallback, useEffect, useRef } from 'react';

// 꾹 누르기: 한 곳을 delay(ms) 동안 누르고 있으면 onLongPress(key)를 부른다. 줄마다 쓰도록 key로 구분하고 타이머는 하나만 둔다(한 번에 한 손가락).
// 손가락·마우스가 moveTolerance(px)보다 많이 움직이면(스크롤·드래그) 취소한다.
// 꾹 누른 뒤 손을 떼면 브라우저가 클릭도 보내므로, 클릭 핸들러 맨 앞에서 consumeClick()이 true이면 클릭을 무시한다.
// 칠판 터치 화면에서 꾹 누르면 글자 선택·메뉴가 뜨므로 bind가 돌려주는 props에 막는 장치(contextmenu, user-select)를 같이 담았다.
export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 5;

export function useLongPress(onLongPress: (key: string, el: HTMLElement) => void, delay = LONG_PRESS_MS) {
  const state = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number; fired: boolean }>({ timer: undefined, x: 0, y: 0, fired: false });
  const handler = useRef(onLongPress);
  useEffect(() => {
    handler.current = onLongPress;
  });

  const cancel = useCallback(() => {
    clearTimeout(state.current.timer);
    state.current.timer = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);

  const bind = useCallback(
    (key: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
        cancel();
        state.current.fired = false; // 새로 누르기 시작하면 지난번 꾹 누르기가 남긴 표시를 지운다
        state.current.x = e.clientX;
        state.current.y = e.clientY;
        const el = e.currentTarget;
        state.current.timer = setTimeout(() => {
          state.current.timer = undefined;
          state.current.fired = true;
          handler.current(key, el);
        }, delay);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (state.current.timer === undefined) return;
        if (Math.hypot(e.clientX - state.current.x, e.clientY - state.current.y) > MOVE_TOLERANCE_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: React.MouseEvent<HTMLElement>) => e.preventDefault(),
    }),
    [cancel, delay],
  );

  // 꾹 누르기가 막 일어난 뒤의 클릭이면 true(한 번만). 클릭 핸들러 맨 앞에서 부른다.
  const consumeClick = useCallback(() => {
    if (!state.current.fired) return false;
    state.current.fired = false;
    return true;
  }, []);

  return { bind, consumeClick };
}
