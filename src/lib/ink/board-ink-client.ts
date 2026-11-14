import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { parseInkStrokes, type InkStroke } from './store';

type Supabase = SupabaseClient<Database>;

// 보기 전용(PC)이 서버 그림을 다시 읽는 안전 주기. 실시간 신호를 놓치거나 연결이 조용히 끊겨도 이 안에는 따라잡는다(탭이 보이는 동안만).
const POLL_MS = 15_000;

// 날짜·모니터의 획 전체를 읽는다. 행이 없으면 빈 목록, 읽지 못하면(테이블 없음·네트워크·권한) null이라 호출한 쪽이 화면의 그림을 그대로 둔다.
export async function fetchBoardInk(supabase: Supabase, date: string, monitor: string): Promise<InkStroke[] | null> {
  const { data, error } = await supabase.from('board_ink').select('strokes').eq('order_date', date).eq('monitor', monitor).maybeSingle();
  if (error) return null;
  return parseInkStrokes(data?.strokes);
}

let channelSeq = 0;

// board_ink가 바뀌면(또는 탭이 다시 보이거나 인터넷이 돌아오거나 15초가 지나면) onChange를 부른다. Realtime은 "바뀌었다"는 신호로만 쓰고 그림은 fetchBoardInk로 다시 읽는다.
// 주문 알림 채널(use-live-refresh)과 따로 연다: 마이그레이션 0057 전에 배포돼 테이블이 발행에 없어도 이 채널만 실패하고 주문 알림은 영향이 없다.
export function subscribeBoardInk(supabase: Supabase, date: string, onChange: () => void): () => void {
  let cancelled = false;
  let channel: RealtimeChannel | null = null;
  void (async () => {
    await supabase.realtime.setAuth(); // 로그인 토큰을 소켓에 먼저 싣는다(없으면 RLS 때문에 신호가 오지 않는다)
    if (cancelled) return;
    channel = supabase
      .channel(`board-ink-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_ink', filter: `order_date=eq.${date}` }, onChange)
      .subscribe();
  })();
  const ifVisible = () => {
    if (document.visibilityState === 'visible') onChange();
  };
  const poll = setInterval(ifVisible, POLL_MS);
  document.addEventListener('visibilitychange', ifVisible);
  window.addEventListener('online', ifVisible);
  return () => {
    cancelled = true;
    clearInterval(poll);
    document.removeEventListener('visibilitychange', ifVisible);
    window.removeEventListener('online', ifVisible);
    if (channel) void supabase.removeChannel(channel);
  };
}
