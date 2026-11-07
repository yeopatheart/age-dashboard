'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocalFlag } from '@/lib/use-local-flag';
import { useLiveRefresh } from '@/lib/realtime/use-live-refresh';
import { describeEvent, diffOrders, planCues, type OrderEvent, type OrderSnapshot } from '@/lib/sound/order-events';
import { playCues } from '@/lib/sound/player';
import { useSoundSettings } from '@/lib/sound/settings';
import { getAudioContext, isAudioRunning, playTone, subscribeAudioState, unlockAudio } from '@/lib/sound/tones';
import { primeVoice } from '@/lib/sound/voice';

// 실시간 알림 = 실시간 갱신 + 변경 소리·목록. 칠판 기기에서만 켠다(기기마다 따로 저장). 입력하는 PC·휴대폰에서는 켜지 않으므로
// 내가 고친 주문이 나에게 울리거나 입력 중 화면이 바뀌는 일이 없다. 같은 브라우저의 두 창은 설정을 공유하므로
// 한쪽 칠판 창의 주소에 `&sound=off`를 붙이면 그 창만 조용히 갱신만 한다.
const BURST_QUIET_MS = 1500; // 이벤트가 이 시간 동안 더 오지 않으면 모아서 한 번에 알린다
const BURST_MAX_MS = 4000; // 계속 오더라도 이 시간이 지나면 일단 알린다
const RECENT_LIMIT = 12;
const STALE_MS = 10 * 60_000; // 마지막 갱신이 이 시간보다 오래되면 낡은 화면으로 본다

interface RecentEvent {
  at: number;
  text: string;
  urgent: boolean;
}

// 휴대폰 화면에는 붙이지 않는다(dashboard-client가 PC 화면에만 렌더한다).
export function DashboardSound({ rows, items, orderDate }: OrderSnapshot & { orderDate: string }) {
  const searchParams = useSearchParams();
  // 저장 키는 예전 이름(board-mode)을 그대로 쓴다: 바꾸면 이미 켜 둔 기기의 설정이 초기화된다.
  const [mode, setBoardOn] = useLocalFlag('board-mode');
  const [settings] = useSoundSettings();
  // 이 기기의 칠판만 소리를 끄는 스위치(주소의 &sound=off는 창 하나만 끄는 용도라 따로 둔다)
  const [muted, setMuted] = useLocalFlag('board-muted');
  const soundOn = mode && !muted && searchParams.get('sound') !== 'off';
  const { status, lastRefreshAt } = useLiveRefresh(mode);
  // "마지막 갱신"이 오래되면(타이머가 멈춘 TV 등) 칩을 붉게 바꿔 낡은 화면임을 알린다. 현재 시각은 30초마다만 갱신한다.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!mode) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [mode]);
  const stale = lastRefreshAt !== null && now > 0 && now - lastRefreshAt > STALE_MS;
  // 칠판 끄기는 실수로 누르기 쉬워서(끄면 화면이 멈춘다) 4초 안에 한 번 더 눌러야 꺼진다.
  const [confirmOff, setConfirmOff] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestOff = () => {
    if (!confirmOff) {
      setConfirmOff(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmOff(false), 4000);
      return;
    }
    clearTimeout(confirmTimer.current);
    setConfirmOff(false);
    setBoardOn(false);
  };
  const toggleMuted = () => {
    if (muted) {
      // 소리를 다시 켜는 이 클릭이 브라우저가 소리를 허용하는 "사용자 조작"이다.
      setMuted(false);
      void unlockAudio();
      primeVoice();
    } else {
      setMuted(true);
    }
  };
  const audioRunning = useSyncExternalStore(subscribeAudioState, isAudioRunning, () => false);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [listOpen, setListOpen] = useState(false);

  // 타이머 안에서 최신 설정·소리 여부를 읽기 위한 사본(렌더 중이 아니라 이펙트에서 갱신한다).
  const live = useRef({ soundOn, settings });
  useEffect(() => {
    live.current = { soundOn, settings };
  });

  // 칠판이 켜져 있는 동안 화면이 꺼지거나 PC가 절전하지 않게 한다(절전하면 브라우저가 페이지를 멈춰 소리·갱신이 모두 멈춘다).
  // 탭이 다시 보일 때마다 다시 요청한다(숨겨지면 브라우저가 자동으로 풀어 버린다). 지원하지 않는 브라우저에서는 조용히 넘어간다.
  useEffect(() => {
    if (!mode || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release().catch(() => {});
        else sentinel = lock;
      } catch {
        // 배터리 절약 모드 등으로 거절될 수 있다 — 그래도 칠판은 동작한다
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [mode]);

  // 실시간 알림이 켜져 있으면 음성 컨텍스트를 미리 만들어 둔다(자동재생이 허용된 환경이면 바로 running이 된다).
  useEffect(() => {
    if (soundOn) getAudioContext();
  }, [soundOn]);

  // 새 데이터가 올 때마다 직전 화면과 비교한다. 날짜가 바뀌면(다른 날 조회) 비교하지 않고 기준만 바꾼다.
  const prevRef = useRef<(OrderSnapshot & { orderDate: string }) | null>(null);
  const bufferRef = useRef<OrderEvent[]>([]);
  const quietTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { rows, items, orderDate };
    if (!prev || prev.orderDate !== orderDate || !mode) return;
    const events = diffOrders(prev, { rows, items });
    if (events.length === 0) return;
    bufferRef.current.push(...events);

    const flush = () => {
      clearTimeout(quietTimer.current);
      clearTimeout(maxTimer.current);
      maxTimer.current = undefined;
      const batch = bufferRef.current;
      bufferRef.current = [];
      if (batch.length === 0) return;
      const now = Date.now();
      setRecent((list) =>
        [...batch.filter((e) => e.kind !== 'item-packed').map((e) => ({ at: now, text: describeEvent(e), urgent: e.kind === 'packed-item-changed' })), ...list].slice(0, RECENT_LIMIT),
      );
      const { soundOn: on, settings: s } = live.current;
      if (on) void playCues(planCues(batch, s.mode, s.disabled), s);
    };
    clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(flush, BURST_QUIET_MS);
    maxTimer.current ??= setTimeout(flush, BURST_MAX_MS);
  }, [rows, items, orderDate, mode]);

  useEffect(
    () => () => {
      clearTimeout(quietTimer.current);
      clearTimeout(maxTimer.current);
    },
    [],
  );

  // 연결이 끊기면 소리로도 알린다(낡은 화면을 믿고 작업하는 것이 가장 위험하다).
  useEffect(() => {
    if (status !== 'down') return;
    const { soundOn: on, settings: s } = live.current;
    if (on) void playCues([{ tone: 'disconnected', say: ['연결이 끊겼습니다'] }], s);
  }, [status]);

  const turnOn = async () => {
    setBoardOn(true);
    // 이 클릭이 브라우저가 소리를 허용하는 "사용자 조작"이다. 오디오와 음성 엔진을 함께 깨운다.
    const ok = await unlockAudio();
    primeVoice();
    if (ok) void playTone('test', settings.volume);
  };

  return (
    <>
      {status === 'down' && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-center font-bold py-2 text-base">
          연결이 끊겼습니다 — 화면이 최신이 아닐 수 있습니다. 다시 연결되면 자동으로 갱신됩니다.
        </div>
      )}

      {!mode && (
        <button
          type="button"
          onClick={turnOn}
          className="fixed bottom-3 right-3 z-40 h-8 px-3 rounded-full bg-slate-800/80 text-white text-xs font-bold hover:bg-slate-800"
        >
          실시간 알림 켜기
        </button>
      )}

      {mode && (
        <div title="이 탭이 뒤로 가거나 PC가 절전하면 브라우저가 페이지를 멈춰 소리·갱신이 멈출 수 있습니다. 칠판은 별도 창으로 띄워 두세요." className={`fixed bottom-3 right-3 z-40 flex items-center gap-2 rounded-full shadow border pl-4 pr-1 h-10 text-sm font-bold ${stale || status === 'down' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white/95 border-slate-200 text-slate-600'}`}>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${status === 'live' && !stale ? 'bg-emerald-500' : status === 'down' || stale ? 'bg-red-500' : 'bg-amber-400'}`} />
          <span>{status === 'live' ? '실시간' : status === 'down' ? '끊김' : '연결 중'}</span>
          <span className="font-medium">· {lastRefreshAt ? `갱신 ${new Date(lastRefreshAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}` : '갱신 대기'}{stale ? ' (오래됨)' : ''}</span>
          <button type="button" onClick={toggleMuted} aria-pressed={!muted} className="px-3 h-8 rounded-full hover:bg-slate-100">소리 {soundOn ? '켬' : '끔'}</button>
          <Link href="/dashboard/sound-test" className="px-3 h-8 inline-flex items-center rounded-full hover:bg-slate-100">설정</Link>
          <button type="button" onClick={requestOff} className={`px-3 h-8 rounded-full ${confirmOff ? 'bg-red-600 text-white' : 'hover:bg-slate-100'}`}>{confirmOff ? '정말 끄기?' : '끄기'}</button>
        </div>
      )}

      {soundOn && !audioRunning && (
        <button
          type="button"
          onClick={turnOn}
          className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 h-12 px-6 rounded-full bg-amber-500 text-white text-base font-bold shadow-lg"
        >
          소리가 꺼져 있습니다 — 눌러서 켜기
        </button>
      )}

      {mode && recent.length > 0 && (
        <div className="fixed bottom-3 left-3 z-40 flex flex-col items-start gap-2">
          {listOpen && (
            <ul className="w-80 max-h-72 overflow-y-auto rounded-xl bg-white shadow-lg border border-slate-200 p-2 space-y-1">
              {recent.map((e, i) => (
                <li key={`${e.at}-${i}`} className={`text-sm leading-snug rounded-md px-2 py-1 ${e.urgent ? 'bg-red-50 text-red-700 font-bold' : 'text-slate-700'}`}>
                  <span className="text-xs text-slate-400 mr-1">{new Date(e.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                  {e.text}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setListOpen((o) => !o)}
              className={`h-9 px-4 rounded-full text-sm font-bold shadow text-white ${recent.some((e) => e.urgent) ? 'bg-red-600' : 'bg-sky-600'}`}
            >
              변경 {recent.length}건 보기
            </button>
            <button
              type="button"
              onClick={() => {
                setRecent([]);
                setListOpen(false);
              }}
              className="h-9 px-4 rounded-full text-sm font-bold shadow bg-white border border-slate-300 text-slate-700"
            >
              모두 확인
            </button>
          </div>
        </div>
      )}
    </>
  );
}
