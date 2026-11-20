'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

// 고객사 간 합포장 "연결 대기" 상태: 한 칠판에서 고객명을 꾹 눌러 첫 고객을 고르면, 다른 칠판(모니터 1·2가 서로 다른 기기)과 PC에도
// 같은 대기 상태가 보여서 어느 화면에서든 두 번째 고객을 눌러 연결할 수 있다. DB에 저장하지 않고 Supabase Realtime broadcast(임시 메시지)로만 나눈다.
// 연결이 끊겨도 이 기기 안에서는 그대로 동작한다. 같은 날짜의 화면끼리만 나눈다. 대기는 PENDING_MS가 지나면 저절로 사라진다.
export const PENDING_MS = 30_000;

export interface BoxLinkPending {
  dailyBusinessId: string;
  name: string;
  expiresAt: number; // ms
}

const EVENT_START = 'start';
const EVENT_CLEAR = 'clear';

export function useBoxLinkPending(orderDate: string) {
  const [pending, setPending] = useState<BoxLinkPending | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((next: BoxLinkPending | null) => {
    clearTimeout(expireTimer.current);
    setPending(next);
    if (next) expireTimer.current = setTimeout(() => setPending(null), Math.max(0, next.expiresAt - Date.now()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      try {
        // 실시간 구독과 같이, 토큰을 먼저 소켓에 싣는다. 같은 이름(topic)의 지워지는 중인 채널이 남아 있으면 먼저 치운다.
        await supabase.realtime.setAuth();
        const topic = `box-link-pending-${orderDate}`;
        const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
        if (stale) await supabase.removeChannel(stale);
        if (cancelled) return;
        const channel = supabase
          .channel(topic, { config: { broadcast: { self: false } } })
          .on('broadcast', { event: EVENT_START }, ({ payload }) => {
            const p = payload as Partial<BoxLinkPending> | null;
            if (p && typeof p.dailyBusinessId === 'string' && typeof p.name === 'string' && typeof p.expiresAt === 'number' && p.expiresAt > Date.now()) {
              apply({ dailyBusinessId: p.dailyBusinessId, name: p.name, expiresAt: p.expiresAt });
            }
          })
          .on('broadcast', { event: EVENT_CLEAR }, () => apply(null))
          .subscribe();
        channelRef.current = channel;
      } catch {
        // 나눔이 안 돼도 이 기기 안에서는 동작한다.
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(expireTimer.current);
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orderDate, apply]);

  const send = useCallback((event: string, payload: object) => {
    void channelRef.current?.send({ type: 'broadcast', event, payload }).catch(() => undefined);
  }, []);

  const start = useCallback(
    (dailyBusinessId: string, name: string) => {
      const next = { dailyBusinessId, name, expiresAt: Date.now() + PENDING_MS };
      apply(next);
      send(EVENT_START, next);
    },
    [apply, send],
  );

  const clear = useCallback(() => {
    apply(null);
    send(EVENT_CLEAR, {});
  }, [apply, send]);

  return { pending, start, clear };
}
