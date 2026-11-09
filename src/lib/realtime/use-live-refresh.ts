'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'down';

export interface LiveInfo {
  status: LiveStatus;
  lastRefreshAt: number | null; // 화면을 서버에서 마지막으로 다시 받아오라고 한 시각(ms). 칠판이 오래 멈춘 것을 알아차리는 데 쓴다.
}

const SAFETY_REFRESH_MS = 60_000; // 실시간 신호가 조용히 끊겨도(TV 절전 등) 이 간격으로는 화면을 새로 받는다(탭이 보이는 동안만)

// 다른 기기에서 주문 줄·업체 카드가 바뀌면 이 화면을 서버에서 다시 받아온다(router.refresh).
// Realtime은 "바뀌었다"는 신호로만 쓰고, 화면 데이터는 지금처럼 서버에서 읽는다(권한·조인 로직을 한 곳에 둔다).
// 구독에는 새 권한 설정이 필요 없다: RLS는 로그인 사용자 전체 허용이고, 두 테이블을 발행에 넣는 마이그레이션 0041만 있으면 된다.
// 연결이 끊겼다 돌아오면 놓친 변경(Realtime은 다시 보내주지 않는다)을 위해 한 번 더 새로 받아온다.
// 신호가 조용히 멈춘 경우를 위해 1분마다(탭이 보이는 동안) 안전 새로고침도 한다.
// 탭이 뒤로 가거나 PC가 절전하면 브라우저가 페이지(타이머·실시간 연결)를 멈춘다. 그래서 다시 보이거나 깨어나거나 인터넷이 돌아오면
// 즉시 새로 받아 멈춰 있던 동안의 변경을 따라잡고(그 변경은 소리로도 알려진다), 죽은 실시간 연결은 새로 연다. 2026-11-07 현장에서 "갱신이 멈췄다"고 한 증상이다.
export function useLiveRefresh(enabled: boolean): LiveInfo {
  const router = useRouter();
  const [status, setStatus] = useState<Exclude<LiveStatus, 'off'>>('connecting');
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshNow = () => {
      router.refresh();
      setLastRefreshAt(Date.now());
    };
    // 카카오 주문 한 번 확정으로 여러 줄이 연달아 바뀌므로 400ms 안의 신호는 한 번의 새로고침으로 묶는다.
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(refreshNow, 400);
    };
    // 숨겨진 탭은 다시 보일 때 wake()가 곧바로 따라잡으므로 보이는 동안만 돌린다.
    const safety = setInterval(() => {
      if (document.visibilityState === 'visible') refreshNow();
    }, SAFETY_REFRESH_MS);
    // 새로고침 직후 첫 구독이 로그인 토큰 없이 붙으면 RLS 때문에 변경 신호가 오지 않는다(칩은 "실시간"인데 갱신이 없다).
    // 그래서 토큰을 먼저 받아 소켓에 싣고 구독한다. 채널 이름은 매번 달리해, 막 지운 같은 이름의 채널을 supabase-js가 되돌려주는 일을 막는다.
    let seq = 0;
    let channel: RealtimeChannel | null = null;
    let connecting = false;
    const connect = async () => {
      if (connecting) return;
      connecting = true;
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase
          .channel(`board-orders-${++seq}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, refreshSoon)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_businesses' }, refreshSoon)
          .subscribe((s) => {
            if (cancelled) return;
            if (s === 'SUBSCRIBED') {
              setStatus('live');
              refreshSoon(); // 화면을 받은 뒤 구독이 붙기 전까지의 변경을 메운다(재연결 때도 같다)
            } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
              setStatus('down');
            }
          });
      } finally {
        connecting = false;
      }
    };
    void connect();
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (!connecting && String(channel?.state) !== 'joined') {
        const old = channel;
        channel = null;
        setStatus('connecting');
        void (async () => {
          if (old) await supabase.removeChannel(old);
          await connect();
        })();
      }
      refreshSoon();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(safety);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
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
