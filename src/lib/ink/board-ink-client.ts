import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { parseInkStrokes, type InkStroke } from './store';

type Supabase = SupabaseClient<Database>;

// 보기 전용(PC)이 서버 그림을 다시 읽는 안전 주기. 실시간 신호를 놓치거나 연결이 조용히 끊겨도 이 안에는 따라잡는다(탭이 보이는 동안만).
const POLL_MS = 15_000;

export interface BoardInk {
  strokes: InkStroke[];
  updatedAt: string | null; // 행이 없으면 null
}

// 날짜·모니터의 획 전체를 읽는다. 행이 없으면 빈 목록, 읽지 못하면(테이블 없음·네트워크·권한) null이라 호출한 쪽이 화면의 그림을 그대로 둔다.
export async function fetchBoardInk(supabase: Supabase, date: string, monitor: string): Promise<BoardInk | null> {
  const { data, error } = await supabase.from('board_ink').select('strokes, updated_at').eq('order_date', date).eq('monitor', monitor).maybeSingle();
  if (error) return null;
  return { strokes: parseInkStrokes(data?.strokes), updatedAt: data?.updated_at ?? null };
}

// 그림이 마지막으로 저장된 시각만 읽는다(행이 없으면 null, 읽지 못하면 undefined). 안전 주기(POLL_MS)마다 획 전체(수백 KB가 될 수 있다)를
// 다시 받지 않고, 이 값이 달라졌을 때만 전체를 읽기 위한 것이다.
export async function fetchBoardInkStamp(supabase: Supabase, date: string, monitor: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from('board_ink').select('updated_at').eq('order_date', date).eq('monitor', monitor).maybeSingle();
  if (error) return undefined;
  return data?.updated_at ?? null;
}

let channelSeq = 0;

// board_ink가 바뀌면(또는 탭이 다시 보이거나 인터넷이 돌아오거나 15초가 지나면) onChange를 부른다. 15초 주기에서 부를 때는 'poll'을 넘겨,
// 받는 쪽이 저장 시각만 먼저 확인하게 한다. Realtime은 "바뀌었다"는 신호로만 쓰고 그림은 fetchBoardInk로 다시 읽는다.
// 주문 알림 채널(use-live-refresh)과 따로 연다: 마이그레이션 0057 전에 배포돼 테이블이 발행에 없어도 이 채널만 실패하고 주문 알림은 영향이 없다.
export function subscribeBoardInk(supabase: Supabase, date: string, onChange: (reason: 'signal' | 'poll') => void): () => void {
  let cancelled = false;
  let channel: RealtimeChannel | null = null;
  void (async () => {
    await supabase.realtime.setAuth(); // 로그인 토큰을 소켓에 먼저 싣는다(없으면 RLS 때문에 신호가 오지 않는다)
    if (cancelled) return;
    channel = supabase
      .channel(`board-ink-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_ink', filter: `order_date=eq.${date}` }, () => onChange('signal'))
      .subscribe();
  })();
  const ifVisible = () => {
    if (document.visibilityState === 'visible') onChange('signal');
  };
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible') onChange('poll');
  }, POLL_MS);
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
