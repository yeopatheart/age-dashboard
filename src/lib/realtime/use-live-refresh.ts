'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'down';

export interface LiveInfo {
  status: LiveStatus;
  lastRefreshAt: number | null; // 화면을 서버에서 마지막으로 다시 받아오라고 한 시각(ms). 칠판이 오래 멈춘 것을 알아차리는 데 쓴다.
}

const SAFETY_REFRESH_MS = 5 * 60_000; // 실시간 신호가 조용히 끊겨도(TV 절전 등) 이 간격으로는 화면을 새로 받는다

// 다른 기기에서 주문 줄·업체 카드가 바뀌면 이 화면을 서버에서 다시 받아온다(router.refresh).
// Realtime은 "바뀌었다"는 신호로만 쓰고, 화면 데이터는 지금처럼 서버에서 읽는다(권한·조인 로직을 한 곳에 둔다).
// 구독에는 새 권한 설정이 필요 없다: RLS는 로그인 사용자 전체 허용이고, 두 테이블을 발행에 넣는 마이그레이션 0041만 있으면 된다.
// 연결이 끊겼다 돌아오면 놓친 변경(Realtime은 다시 보내주지 않는다)을 위해 한 번 더 새로 받아온다.
// 신호가 조용히 멈춘 경우를 위해 5분마다 안전 새로고침도 한다.
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
    const safety = setInterval(refreshNow, SAFETY_REFRESH_MS);
    const channel = supabase
      .channel('board-orders')
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
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(safety);
      supabase.removeChannel(channel);
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
