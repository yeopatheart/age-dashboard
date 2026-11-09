'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useLocalFlag } from '@/lib/use-local-flag';
import { useLiveRefresh } from '@/lib/realtime/use-live-refresh';
import { describeEvent, diffOrders, planCues, type OrderEvent, type OrderSnapshot } from '@/lib/sound/order-events';
import { playCues } from '@/lib/sound/player';
import { useSoundSettings } from '@/lib/sound/settings';
import { getAudioContext, isAudioRunning, playTone, subscribeAudioState, unlockAudio } from '@/lib/sound/tones';
import { primeVoice } from '@/lib/sound/voice';

// 실시간 알림 = 실시간 갱신 + 변경 소리·목록. 켠 기기에서만 동작한다(기기마다 따로 저장, 기본은 꺼짐). 화면은 주문표 위 툴바 안에 들어간다.
// 입력하는 PC에서도 켤 수 있고, 그 PC에서 내가 고친 주문도 똑같이 울린다(같은 화면에서 일어난 변경과 다른 기기의 변경을 구분하지 않는다).
// 같은 브라우저의 두 창은 설정을 공유하므로 한쪽 창의 주소에 `&sound=off`를 붙이면 그 창만 조용히 갱신만 한다.
// 휴대폰 화면에는 이 컴포넌트가 없다. 폰은 소리 없이 30초마다 새로 받는다(dashboard-mobile의 useAutoRefresh).
const BURST_QUIET_MS = 1500; // 이벤트가 이 시간 동안 더 오지 않으면 모아서 한 번에 알린다
const BURST_MAX_MS = 4000; // 계속 오더라도 이 시간이 지나면 일단 알린다
const RECENT_LIMIT = 12;
const STALE_MS = 3 * 60_000; // 마지막 갱신이 이 시간보다 오래되면 낡은 화면으로 본다(안전 새로고침이 1분 간격이라 그보다 충분히 길게)

interface RecentEvent {
  at: number;
  text: string;
  urgent: boolean;
}

// 휴대폰 화면에는 붙이지 않는다(dashboard-client가 PC 화면의 툴바 안에만 렌더한다).
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

  const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const urgentRecent = recent.some((e) => e.urgent);

  // 주문표 위쪽 툴바 안에 들어가는 컨트롤이다(dashboard-client가 툴바 오른쪽에 놓는다). 화면에 떠 있게(fixed) 두면 표의 맨 아래 행을 가리고,
  // TV처럼 한 화면에 고정해서 보는 모드에서는 스크롤로도 피할 수 없어서 툴바로 옮겼다. 연결이 끊겼을 때의 전체 폭 경고 띠만 위에 고정한다.
  return (
    <>
      {status === 'down' && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-center font-bold py-2 text-base">
          연결이 끊겼습니다 — 화면이 최신이 아닐 수 있습니다. 다시 연결되면 자동으로 갱신됩니다.
        </div>
      )}

      {soundOn && !audioRunning && (
        <button type="button" onClick={turnOn} className="h-8 px-3 rounded-lg bg-amber-500 text-white text-xs font-bold shadow-sm hover:bg-amber-600">
          소리가 꺼져 있습니다 — 눌러서 켜기
        </button>
      )}

      {mode && recent.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
            className={`h-8 px-3 rounded-lg text-xs font-bold shadow-sm text-white ${urgentRecent ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'}`}
          >
            변경 {recent.length}건
          </button>
          {listOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setListOpen(false)} />
              <div className="absolute right-0 top-10 z-50 w-80 max-h-[60vh] overflow-y-auto rounded-xl bg-white shadow-lg border border-slate-200 p-2">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs font-bold text-slate-700">최근 변경</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRecent([]);
                      setListOpen(false);
                    }}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    모두 확인
                  </button>
                </div>
                <ul className="space-y-1">
                  {recent.map((e, i) => (
                    <li key={`${e.at}-${i}`} className={`text-sm leading-snug rounded-md px-2 py-1 ${e.urgent ? 'bg-red-50 text-red-700 font-bold' : 'text-slate-700'}`}>
                      <span className="text-xs text-slate-400 mr-1">{hhmm(e.at)}</span>
                      {e.text}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}

      {!mode ? (
        <button
          type="button"
          onClick={turnOn}
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          title="실시간 알림 켜기 — 다른 기기에서 주문이 바뀌면 화면을 바로 갱신하고 소리로 알려 줍니다"
          aria-label="실시간 알림 켜기"
        >
          <Bell className="w-4 h-4" />
        </button>
      ) : (
        <div
          title="이 탭이 뒤로 가거나 PC가 절전하면 브라우저가 페이지를 멈춰 소리·갱신이 멈출 수 있습니다. 칠판은 별도 창으로 띄워 두세요."
          className={`flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1 h-8 text-xs font-bold ${stale || status === 'down' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-slate-200 text-slate-600'}`}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${status === 'live' && !stale ? 'bg-emerald-500' : status === 'down' || stale ? 'bg-red-500' : 'bg-amber-400'}`} />
          <span>{status === 'live' ? '실시간' : status === 'down' ? '끊김' : '연결 중'}</span>
          <span className="font-medium">· {lastRefreshAt ? `갱신 ${hhmm(lastRefreshAt)}` : '갱신 대기'}{stale ? ' (오래됨)' : ''}</span>
          <button type="button" onClick={toggleMuted} aria-pressed={!muted} className="px-2 h-6 rounded-md hover:bg-slate-100">소리 {soundOn ? '켬' : '끔'}</button>
          <Link href="/dashboard/sound-test" className="px-2 h-6 inline-flex items-center rounded-md hover:bg-slate-100">설정</Link>
          <button type="button" onClick={requestOff} className={`px-2 h-6 rounded-md ${confirmOff ? 'bg-red-600 text-white' : 'hover:bg-slate-100'}`}>{confirmOff ? '정말 끄기?' : '끄기'}</button>
        </div>
      )}
    </>
  );
}
