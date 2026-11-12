'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell, BellOff, BellRing } from 'lucide-react';
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
const TITLE_BADGE = /^\(변경 \d+\) /; // 탭 제목 앞에 붙이는 "(변경 N)" 배지
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const; // 브라우저가 "사용자 조작"으로 치는 입력
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
  // 브라우저가 소리를 막아 알리지 못하고 버린 변경 수. 소리가 켜진 뒤에 "놓친 변경"으로 한 번 알려 준다(묵은 소리를 다시 내지는 않는다).
  const [missed, setMissed] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // 알림 버튼을 누르면 버튼 아래로 떠오르는 설정 패널(툴바 크기는 변하지 않는다)

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
      if (!on) return;
      const cues = planCues(batch, s.mode, s.disabled);
      if (cues.length === 0) return;
      const audible = batch.filter((e) => e.kind !== 'item-packed' && !s.disabled.includes(e.kind)).length;
      void playCues(cues, s).then((played) => {
        if (!played && audible > 0) setMissed((n) => n + audible);
      });
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

  // 소리가 막혀 있는 동안에는 화면의 아무 곳이나 처음 누르는 순간 오디오와 음성을 함께 깨운다(브라우저가 허용하는 "사용자 조작").
  // 앰버 버튼을 정확히 눌러야만 풀리면, 새로고침 뒤에 칠판을 만진 작업자는 소리가 꺼진 줄 모르고 지나친다. 풀리면 이 이펙트가 정리된다.
  useEffect(() => {
    if (!soundOn || audioRunning) return;
    const attempt = () => {
      primeVoice();
      void unlockAudio();
    };
    for (const type of UNLOCK_EVENTS) document.addEventListener(type, attempt, { capture: true, passive: true });
    return () => {
      for (const type of UNLOCK_EVENTS) document.removeEventListener(type, attempt, { capture: true });
    };
  }, [soundOn, audioRunning]);

  // 탭이 뒤로 가 있어도(소리가 없어도) 새 변경이 있는지 탭 제목으로 알린다. 제목을 되돌릴 때는 배지만 떼어서, 그 사이 바뀐 제목을 덮어쓰지 않는다.
  useEffect(() => {
    if (!mode || recent.length === 0) return;
    document.title = `(변경 ${recent.length}) ${document.title.replace(TITLE_BADGE, '')}`;
    return () => {
      document.title = document.title.replace(TITLE_BADGE, '');
    };
  }, [mode, recent.length]);

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
  const closeMenu = () => {
    setMenuOpen(false);
    clearTimeout(confirmTimer.current);
    setConfirmOff(false); // 열어 둔 채 닫으면 "정말 끄기?" 확인도 풀어 둔다
  };

  // 버튼 하나로 상태를 구분한다: 꺼짐(회색·벨 꺼짐) / 켜짐·정상(초록·울리는 벨) / 켜짐이지만 소리가 없거나 연결 중(노랑) / 끊김·오래됨(빨강).
  const problem = mode && (status === 'down' || stale);
  const connecting = mode && status === 'connecting';
  const quiet = mode && !soundOn; // 켜져 있지만 소리가 나지 않음(이 기기 소리 끔 또는 주소의 &sound=off)
  const tone: 'off' | 'ok' | 'warn' | 'bad' = !mode ? 'off' : problem ? 'bad' : connecting || quiet ? 'warn' : 'ok';
  const BellIcon = tone === 'off' ? BellOff : tone === 'ok' ? BellRing : Bell;
  const TONE_CLASS = {
    off: 'border-slate-200 bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-600',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    warn: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
    bad: 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100',
  } as const;
  const statusText = status === 'live' ? '실시간' : status === 'down' ? '끊김' : '연결 중';
  const bellLabel = !mode ? '실시간 알림 꺼짐' : `실시간 알림 켜짐 — ${statusText}${stale ? '(오래됨)' : ''}${quiet ? ', 소리 꺼짐' : ''}`;

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
        <button
          type="button"
          onClick={turnOn}
          className={`h-8 px-3 rounded-lg bg-amber-500 text-white text-xs font-bold shadow-sm hover:bg-amber-600 ${missed > 0 ? 'animate-pulse' : ''}`}
        >
          소리가 꺼져 있습니다 — 눌러서 켜기{missed > 0 ? ` (놓친 변경 ${missed}건)` : ''}
        </button>
      )}

      {soundOn && audioRunning && missed > 0 && (
        <button
          type="button"
          onClick={() => {
            setMissed(0);
            setListOpen(true);
          }}
          className="h-8 px-3 rounded-lg border border-amber-400 bg-amber-50 text-amber-800 text-xs font-bold shadow-sm hover:bg-amber-100"
        >
          소리가 꺼진 동안 변경 {missed}건 — 눌러서 보기
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
                      setMissed(0);
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

      <div className="relative">
        <button
          type="button"
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          aria-label={bellLabel}
          title={`${bellLabel} (눌러서 설정)`}
          className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors ${TONE_CLASS[tone]}`}
        >
          <BellIcon className="w-4 h-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={closeMenu} />
            <div role="dialog" aria-label="실시간 알림 설정" className="absolute right-0 top-10 z-50 w-72 rounded-xl bg-white shadow-lg border border-slate-200 p-3 text-sm">
              {!mode ? (
                <>
                  <p className="font-bold text-slate-800">실시간 알림 꺼짐</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">켜면 다른 기기에서 주문이 바뀔 때 이 화면을 바로 갱신하고, 소리로 알려 줍니다. 칠판으로 쓰는 기기에서 켜 두세요(기기마다 따로 저장됩니다).</p>
                  <button type="button" onClick={turnOn} className="mt-3 h-9 w-full rounded-lg bg-[#003057] text-white text-sm font-bold hover:opacity-90">
                    실시간 알림 켜기
                  </button>
                </>
              ) : (
                <>
                  <div className={`flex items-center gap-2 font-bold ${problem ? 'text-red-700' : 'text-slate-800'}`}>
                    <span className={`inline-block h-2 w-2 rounded-full ${status === 'live' && !stale ? 'bg-emerald-500' : problem ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <span>{statusText}</span>
                    <span className="text-xs font-medium text-slate-500">· {lastRefreshAt ? `갱신 ${hhmm(lastRefreshAt)}` : '갱신 대기'}{stale ? ' (오래됨)' : ''}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-bold text-slate-700">소리</span>
                    <button
                      type="button"
                      onClick={toggleMuted}
                      role="switch"
                      aria-checked={!muted}
                      className={`h-8 w-14 rounded-full border text-xs font-bold ${!muted ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-100 text-slate-500'}`}
                    >
                      {muted ? '끔' : '켬'}
                    </button>
                  </div>
                  {searchParams.get('sound') === 'off' && <p className="mt-1 text-xs text-slate-500">이 창은 주소에 &amp;sound=off가 있어 소리가 나지 않습니다.</p>}
                  <Link href="/dashboard/sound-test" onClick={closeMenu} className="mt-3 flex h-9 items-center justify-center rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
                    소리·알림 설정
                  </Link>
                  <button
                    type="button"
                    onClick={requestOff}
                    className={`mt-2 h-9 w-full rounded-lg border text-sm font-bold ${confirmOff ? 'border-red-600 bg-red-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {confirmOff ? '정말 끄기? (화면 갱신도 멈춥니다)' : '실시간 알림 끄기'}
                  </button>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">이 탭이 뒤로 가거나 PC가 절전하면 브라우저가 페이지를 멈춰 소리·갱신이 멈출 수 있습니다. 칠판은 별도 창으로 띄워 두세요.</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
