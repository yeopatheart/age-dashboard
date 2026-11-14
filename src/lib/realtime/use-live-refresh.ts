'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { ItemChange } from '@/lib/sound/apply-item-change';
import { dailyChangeInScope, itemChangeInScope, type LiveScope, type RowChange } from './change-scope';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'down';

export interface LiveInfo {
  status: LiveStatus;
  lastRefreshAt: number | null; // 화면을 서버에서 마지막으로 다시 받아오라고 한 시각(ms). 칠판이 오래 멈춘 것을 알아차리는 데 쓴다.
}

// 변경 신호를 받은 뒤 화면을 새로 받기까지 모으는 시간. 소리는 신호가 오는 즉시 따로 내므로(onItemChange) 화면 갱신만 이만큼 늦는다.
// 뒤따르는 신호가 이 시간 안에 계속 오면 한 번으로 묶되, 첫 신호부터 REFRESH_MAX_WAIT_MS가 지나면 기다리지 않고 받는다(2026-11-14: 0.15초 → 0.5초, 사용자 결정).
const REFRESH_DEBOUNCE_MS = 500;
const REFRESH_MAX_WAIT_MS = 2_000;
// 안전 새로고침: 실시간 신호가 조용히 끊겨도(TV 절전 등) 화면을 새로 받는다(탭이 보이는 동안만). SAFETY_TICK_MS마다 확인해서,
// 실시간이 붙어 있으면 마지막으로 받은 지 SAFETY_LIVE_MS가 지났을 때만, 붙어 있지 않으면 매번 받는다. 한 번 받을 때마다 DB 요청이 10건 넘게 나가므로
// 켜진 기기 수만큼 곱해지는 부하를 줄인다(예전에는 실시간이 정상이어도 1분마다 받았다).
const SAFETY_TICK_MS = 60_000;
const SAFETY_LIVE_MS = 180_000;
// 연결이 잠깐 흔들려 채널이 닫혔다 곧 다시 붙는 것은 흔하다(네트워크 순간 끊김, 서버의 연결 정리). 그때마다 빨간 경고와 "연결이 끊겼습니다" 소리가 나면
// 오경보라서(2026-11-14 현장), 이 시간 안에 다시 붙으면 경고하지 않는다. 그 이상 끊겨 있으면 그때 "끊김"으로 알린다.
const DOWN_GRACE_MS = 8_000;
// 끊긴 채로 있으면 이 간격으로 스스로 다시 연결을 시도한다(탭이 보이는 동안만).
const RECONNECT_RETRY_MS = 10_000;

// 다른 기기에서 주문 줄·업체 카드가 바뀌면 이 화면을 서버에서 다시 받아온다(router.refresh).
// Realtime은 "바뀌었다"는 신호로만 쓰고, 화면 데이터는 지금처럼 서버에서 읽는다(권한·조인 로직을 한 곳에 둔다).
// 구독에는 새 권한 설정이 필요 없다: RLS는 로그인 사용자 전체 허용이고, 두 테이블을 발행에 넣는 마이그레이션 0041만 있으면 된다.
// 연결이 끊겼다 돌아오면 놓친 변경(Realtime은 다시 보내주지 않는다)을 위해 한 번 더 새로 받아온다.
// 신호가 조용히 멈춘 경우를 위해 안전 새로고침도 한다(실시간이 붙어 있으면 3분, 아니면 1분 간격. 탭이 보이는 동안만).
// scope를 주면 지금 보는 날짜의 변경일 때만 새로 받는다(다른 날짜의 변경은 이 화면과 무관하다). 판단은 change-scope.ts.
// 탭이 뒤로 가거나 PC가 절전하면 브라우저가 페이지(타이머·실시간 연결)를 멈춘다. 그래서 다시 보이거나 깨어나거나 인터넷이 돌아오면
// 즉시 새로 받아 멈춰 있던 동안의 변경을 따라잡고(그 변경은 소리로도 알려진다), 죽은 실시간 연결은 새로 연다. 2026-11-07 현장에서 "갱신이 멈췄다"고 한 증상이다.
// onItemChange: order_items 변경 신호가 올 때마다 화면 갱신을 기다리지 않고 바로 부른다(변경 소리를 빨리 내기 위해). 신호에 담긴 행을 그대로 넘긴다.
export function useLiveRefresh(enabled: boolean, onItemChange?: (change: ItemChange) => void, scope?: LiveScope): LiveInfo {
  const itemChangeRef = useRef(onItemChange);
  const scopeRef = useRef(scope);
  useEffect(() => {
    itemChangeRef.current = onItemChange;
    scopeRef.current = scope;
  });
  const router = useRouter();
  const [status, setStatus] = useState<Exclude<LiveStatus, 'off'>>('connecting');
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstSignalAt = 0; // 묶는 중인 첫 신호의 시각(0 = 묶는 중 아님)
    let lastRefresh = Date.now(); // 화면은 방금 서버에서 받은 상태로 시작한다
    let live = false;
    const refreshNow = () => {
      clearTimeout(timer);
      timer = undefined;
      firstSignalAt = 0;
      lastRefresh = Date.now();
      router.refresh();
      setLastRefreshAt(lastRefresh);
    };
    // 카카오 주문 한 번 확정으로 여러 줄이 연달아 바뀌므로 짧은 시간(REFRESH_DEBOUNCE_MS) 안의 신호는 한 번의 새로고침으로 묶는다.
    // 신호가 끊이지 않아도 첫 신호부터 REFRESH_MAX_WAIT_MS 안에는 받는다.
    const refreshSoon = () => {
      const now = Date.now();
      if (firstSignalAt === 0) firstSignalAt = now;
      clearTimeout(timer);
      timer = setTimeout(refreshNow, Math.max(0, Math.min(REFRESH_DEBOUNCE_MS, firstSignalAt + REFRESH_MAX_WAIT_MS - now)));
    };
    // 숨겨진 탭은 다시 보일 때 wake()가 곧바로 따라잡으므로 보이는 동안만 돌린다.
    // 타이머가 한참 멈췄다 돌아온 것(PC 절전에서 깨어남)을 알아차리면 실시간 상태와 상관없이 바로 받는다.
    let lastTick = Date.now();
    const safety = setInterval(() => {
      const now = Date.now();
      const slept = now - lastTick > SAFETY_TICK_MS * 2;
      lastTick = now;
      if (document.visibilityState !== 'visible') return;
      if (slept || !live || now - lastRefresh >= SAFETY_LIVE_MS) refreshNow();
    }, SAFETY_TICK_MS);
    // 이 날짜로 방금 들어온 업체 카드. 화면을 새로 받기 전에 그 카드의 주문 줄 신호가 먼저 오므로 따로 기억해 둔다.
    const incomingDailyIds = new Set<string>();
    const onDailyChange = (change: RowChange) => {
      const current = scopeRef.current;
      if (current && !dailyChangeInScope(current, change)) return;
      const id = typeof change.new.id === 'string' ? change.new.id : '';
      if (id) incomingDailyIds.add(id);
      refreshSoon();
    };
    const onItemRowChange = (change: RowChange) => {
      itemChangeRef.current?.(change); // 소리 쪽은 자기 화면의 줄인지 스스로 가린다(모르는 카드의 줄은 무시한다)
      const current = scopeRef.current;
      if (current && !itemChangeInScope(current, change, incomingDailyIds)) return;
      refreshSoon();
    };
    // 새로고침 직후 첫 구독이 로그인 토큰 없이 붙으면 RLS 때문에 변경 신호가 오지 않는다(칩은 "실시간"인데 갱신이 없다).
    // 그래서 토큰을 먼저 받아 소켓에 싣고 구독한다. 채널 이름은 매번 달리해, 막 지운 같은 이름의 채널을 supabase-js가 되돌려주는 일을 막는다.
    let seq = 0;
    let channel: RealtimeChannel | null = null;
    let connecting = false;
    let downTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      if (connecting) return;
      connecting = true;
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase
          .channel(`board-orders-${++seq}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, (payload) => onItemRowChange({ eventType: payload.eventType, new: payload.new, old: payload.old }))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_businesses' }, (payload) => onDailyChange({ eventType: payload.eventType, new: payload.new, old: payload.old }))
          .subscribe((s) => {
            if (cancelled) return;
            if (s === 'SUBSCRIBED') {
              clearTimeout(downTimer);
              downTimer = undefined;
              live = true;
              setStatus('live');
              refreshSoon(); // 화면을 받은 뒤 구독이 붙기 전까지의 변경을 메운다(재연결 때도 같다)
            } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
              live = false;
              // 바로 "끊김"으로 알리지 않고 유예 시간 동안은 "연결 중"으로 둔다. supabase-js가 스스로 다시 붙으면 위 SUBSCRIBED가 이 타이머를 지운다.
              setStatus('connecting');
              downTimer ??= setTimeout(() => {
                downTimer = undefined;
                if (!cancelled) setStatus('down');
              }, DOWN_GRACE_MS);
            }
          });
      } finally {
        connecting = false;
      }
    };
    void connect();
    // 죽은 채널을 지우고 새로 연결한다. 이미 붙어 있거나 연결 중이면 아무것도 하지 않는다.
    const reconnectIfDead = () => {
      if (connecting || String(channel?.state) === 'joined') return;
      const old = channel;
      channel = null;
      live = false;
      setStatus('connecting');
      void (async () => {
        if (old) await supabase.removeChannel(old);
        await connect();
      })();
    };
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      reconnectIfDead();
      refreshSoon();
    };
    // 창을 클릭해 포커스만 돌아온 것은 화면이 계속 보이던 상태라 놓친 변경이 없다: 죽은 연결만 살리고 화면은 다시 받지 않는다
    // (PC에서 창을 오갈 때마다 전체를 다시 받던 부하를 없앤다. 탭이 숨었다 보이는 경우와 인터넷 복구는 지금처럼 바로 받는다).
    const onFocus = () => {
      if (document.visibilityState === 'visible') reconnectIfDead();
    };
    // 끊긴 채로 오래 있지 않도록 보이는 동안 주기적으로 확인해 다시 연결한다.
    const retry = setInterval(() => {
      if (document.visibilityState === 'visible') reconnectIfDead();
    }, RECONNECT_RETRY_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', wake);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(downTimer);
      clearInterval(safety);
      clearInterval(retry);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', wake);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, router]);

  return { status: enabled ? status : 'off', lastRefreshAt };
}

// 실시간 구독 없이, 화면이 보이는 동안 일정 간격으로(그리고 다른 탭에서 돌아왔을 때) 서버에서 다시 받아온다.
// 현황처럼 폰으로 가끔 열어 보는 읽기 전용 화면에 쓴다. 반환값은 마지막으로 새로 받아오라고 한 시각(ms), 아직 없으면 null.
export function useAutoRefresh(intervalMs: number): number | null {
  const router = useRouter();
  const [lastAt, setLastAt] = useState<number | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setLastAt(Date.now());
    };
    const timer = setInterval(refresh, intervalMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [intervalMs, router]);
  return lastAt;
}
