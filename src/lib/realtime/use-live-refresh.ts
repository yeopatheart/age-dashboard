'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'down';

// 다른 기기에서 주문 줄·업체 카드가 바뀌면 이 화면을 서버에서 다시 받아온다(router.refresh).
// Realtime은 "바뀌었다"는 신호로만 쓰고, 화면 데이터는 지금처럼 서버에서 읽는다(권한·조인 로직을 한 곳에 둔다).
// 구독에는 새 권한 설정이 필요 없다: RLS는 로그인 사용자 전체 허용이고, 두 테이블을 발행에 넣는 마이그레이션 0041만 있으면 된다.
// 연결이 끊겼다 돌아오면 놓친 변경(Realtime은 다시 보내주지 않는다)을 위해 한 번 더 새로 받아온다.
export function useLiveRefresh(enabled: boolean): LiveStatus {
  const router = useRouter();
  const [status, setStatus] = useState<Exclude<LiveStatus, 'off'>>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 카카오 주문 한 번 확정으로 여러 줄이 연달아 바뀌므로 400ms 안의 신호는 한 번의 새로고침으로 묶는다.
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
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
      supabase.removeChannel(channel);
    };
  }, [enabled, router]);

  return enabled ? status : 'off';
}
