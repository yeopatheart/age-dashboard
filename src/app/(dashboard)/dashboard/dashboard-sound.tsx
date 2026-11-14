'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell, BellRing } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useLiveRefresh } from '@/lib/realtime/use-live-refresh';
import { applyItemChange, type ItemChange } from '@/lib/sound/apply-item-change';
import { describeEvent, diffOrders, planCues, type OrderEvent, type OrderSnapshot } from '@/lib/sound/order-events';
import { playCues } from '@/lib/sound/player';
import { useSoundSettings } from '@/lib/sound/settings';
import { getAudioContext, isAudioRunning, playTone, subscribeAudioState, unlockAudio } from '@/lib/sound/tones';
import { primeVoice } from '@/lib/sound/voice';

// 실시간 알림 = 실시간 갱신 + 변경 소리·이력. **항상 켜져 있다**(2026-11-14 사용자 결정: 끄는 스위치·소리 스위치·"켜기" 버튼을 없앴다).
// 알림 버튼은 최근 변경 이력만 보여 준다. 소리 크기·음성·이벤트별 켜기끄기는 "소리·알림 설정" 화면에서 바꾼다(기기마다 따로 저장).
// 그 PC에서 내가 고친 주문도 똑같이 울린다(같은 화면에서 일어난 변경과 다른 기기의 변경을 구분하지 않는다).
// 같은 브라우저의 두 창 중 한쪽 창의 주소에 `&sound=off`를 붙이면 그 창만 조용히 갱신만 한다.
// 휴대폰 화면에는 이 컴포넌트가 없다. 폰은 소리 없이 30초마다 새로 받는다(dashboard-mobile의 useAutoRefresh).
// 첫 변경은 기다리지 않고 바로 알린다(2026-11-14: 소리가 너무 늦다는 현장 요청). 그 직후 BURST_QUIET_MS 안에 뒤따라오는 변경만 모아서 한 번에 알린다(카카오 일괄 확정 등).
const BURST_QUIET_MS = 400; // 뒤따르는 이벤트가 이 시간 동안 더 오지 않으면 모아 둔 것을 알린다
const BURST_MAX_MS = 1500; // 계속 오더라도 이 시간이 지나면 일단 알린다
const PLAYED_TTL_MS = 8000; // 실시간 신호로 이미 알린 변경이 서버 데이터에서 다시 발견되면 이 시간 안에는 다시 알리지 않는다
const RECENT_LIMIT = 12;
const TITLE_BADGE = /^\(변경 \d+\) /; // 탭 제목 앞에 붙이는 "(변경 N)" 배지
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const; // 브라우저가 "사용자 조작"으로 치는 입력
const STALE_MS = 5 * 60_000; // 마지막 갱신이 이 시간보다 오래되면 낡은 화면으로 본다(실시간이 붙어 있을 때 안전 새로고침이 3분 간격이라 그보다 충분히 길게)

interface RecentEvent {
  at: number;
  text: string;
  urgent: boolean;
}

// 휴대폰 화면에는 붙이지 않는다(dashboard-client가 PC 화면의 툴바 안에만 렌더한다).
export function DashboardSound({ rows, items, orderDate }: OrderSnapshot & { orderDate: string }) {
  const searchParams = useSearchParams();
  const [settings] = useSoundSettings();
  const soundOn = searchParams.get('sound') !== 'off';
  const onItemChangeRef = useRef<(change: ItemChange) => void>(() => {});
  // 지금 보는 날짜의 카드·줄만 화면을 새로 받게 한다(다른 날짜의 변경 신호는 건너뛴다).
  const scope = useMemo(() => ({ orderDate, dailyIds: new Set(rows.map((r) => r.dailyBusinessId)), itemIds: new Set(items.map((i) => i.id)) }), [orderDate, rows, items]);
  const { status, lastRefreshAt } = useLiveRefresh(true, (change) => onItemChangeRef.current(change), scope);
  // "마지막 갱신"이 오래되면(타이머가 멈춘 TV 등) 칩을 붉게 바꿔 낡은 화면임을 알린다. 현재 시각은 30초마다만 갱신한다.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const stale = lastRefreshAt !== null && now > 0 && now - lastRefreshAt > STALE_MS;
  const audioRunning = useSyncExternalStore(subscribeAudioState, isAudioRunning, () => false);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  // 브라우저가 소리를 막아 알리지 못하고 버린 변경 수. 소리가 켜진 뒤에 "놓친 변경"으로 한 번 알려 준다(묵은 소리를 다시 내지는 않는다).
  const [missed, setMissed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false); // 알림 버튼을 누르면 버튼 아래로 떠오르는 이력 패널(툴바 크기는 변하지 않는다)

  // 타이머 안에서 최신 설정·소리 여부를 읽기 위한 사본(렌더 중이 아니라 이펙트에서 갱신한다).
  const live = useRef({ soundOn, settings });
  useEffect(() => {
    live.current = { soundOn, settings };
  });

  // 화면이 꺼지거나 PC가 절전하지 않게 한다(절전하면 브라우저가 페이지를 멈춰 소리·갱신이 모두 멈춘다).
  // 탭이 다시 보일 때마다 다시 요청한다(숨겨지면 브라우저가 자동으로 풀어 버린다). 지원하지 않는 브라우저에서는 조용히 넘어간다.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release().catch(() => {});
        else sentinel = lock;
      } catch {
        // 배터리 절약 모드 등으로 거절될 수 있다 — 그래도 알림은 동작한다
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
  }, []);

  // 음성 컨텍스트를 미리 만들어 둔다(자동재생이 허용된 환경이면 바로 running이 된다).
  useEffect(() => {
    if (soundOn) getAudioContext();
  }, [soundOn]);

  // 변경은 두 길로 들어온다. (1) 실시간 신호의 행을 지금 화면에 바로 반영해 비교(빠름, order_items만), (2) 서버가 새 화면을 보내면 직전 서버 화면과 비교(모든 변경, 놓친 것도 잡는다).
  // (1)이 이미 알린 변경은 (2)에서 같은 종류·업체·상품이면 한 번 건너뛰어 두 번 울리지 않는다. 날짜가 바뀌면(다른 날 조회) 비교하지 않고 기준만 바꾼다.
  const prevRef = useRef<(OrderSnapshot & { orderDate: string }) | null>(null); // 직전에 서버가 보낸 화면
  const baseRef = useRef<(OrderSnapshot & { orderDate: string }) | null>(null); // 실시간 신호까지 반영한 가장 최신 화면
  const playedRef = useRef(new Map<string, number>()); // 실시간 신호로 이미 알린 변경 키 → 만료 시각
  const bufferRef = useRef<OrderEvent[]>([]);
  const windowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); // 열려 있는 동안은 새 이벤트를 모은다
  const maxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enqueueRef = useRef<(events: OrderEvent[]) => void>(() => {});

  // 한 번에 알리고 이력에 남긴다. 타이머·최신 설정은 ref로 읽으므로 한 번만 만든다.
  useEffect(() => {
    const flush = () => {
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
    const openWindow = () => {
      windowTimer.current = setTimeout(closeWindow, BURST_QUIET_MS);
      maxTimer.current ??= setTimeout(closeWindow, BURST_MAX_MS);
    };
    function closeWindow() {
      clearTimeout(windowTimer.current);
      clearTimeout(maxTimer.current);
      windowTimer.current = undefined;
      maxTimer.current = undefined;
      if (bufferRef.current.length === 0) return;
      flush();
      openWindow(); // 방금 낸 소리가 끝나기 전에 또 울리지 않도록 한 번 더 모은다
    }
    enqueueRef.current = (events) => {
      bufferRef.current.push(...events);
      if (windowTimer.current === undefined) {
        flush(); // 첫 변경은 바로 알린다
        openWindow();
      } else {
        clearTimeout(windowTimer.current);
        windowTimer.current = setTimeout(closeWindow, BURST_QUIET_MS);
      }
    };
    return () => {
      clearTimeout(windowTimer.current);
      clearTimeout(maxTimer.current);
    };
  }, []);

  const eventKey = (e: OrderEvent) => `${e.kind}|${e.business}|${e.product ?? ''}`;

  useEffect(() => {
    onItemChangeRef.current = (change) => {
      const base = baseRef.current;
      if (!base) return;
      const next = applyItemChange(base, change);
      if (!next) return;
      const events = diffOrders(base, next);
      baseRef.current = { ...next, orderDate: base.orderDate };
      if (events.length === 0) return;
      const expires = Date.now() + PLAYED_TTL_MS;
      for (const e of events) playedRef.current.set(eventKey(e), expires);
      enqueueRef.current(events);
    };
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { rows, items, orderDate };
    baseRef.current = { rows, items, orderDate };
    if (!prev || prev.orderDate !== orderDate) return;
    const now = Date.now();
    const events = diffOrders(prev, { rows, items }).filter((e) => {
      const key = eventKey(e);
      const expires = playedRef.current.get(key);
      if (expires === undefined) return true;
      playedRef.current.delete(key); // 실시간 신호가 이미 알렸다: 한 번만 건너뛴다
      return expires < now;
    });
    if (events.length === 0) return;
    enqueueRef.current(events);
  }, [rows, items, orderDate]);

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
    if (recent.length === 0) return;
    document.title = `(변경 ${recent.length}) ${document.title.replace(TITLE_BADGE, '')}`;
    return () => {
      document.title = document.title.replace(TITLE_BADGE, '');
    };
  }, [recent.length]);

  // 연결이 끊기면 소리로도 알린다(낡은 화면을 믿고 작업하는 것이 가장 위험하다).
  useEffect(() => {
    if (status !== 'down') return;
    const { soundOn: on, settings: s } = live.current;
    if (on) void playCues([{ tone: 'disconnected', say: ['연결이 끊겼습니다'] }], s);
  }, [status]);

  // 브라우저가 소리를 막고 있을 때 누르는 "소리 켜기" 버튼. 이 클릭이 브라우저가 소리를 허용하는 "사용자 조작"이다.
  const unlockSound = async () => {
    const ok = await unlockAudio();
    primeVoice();
    if (ok) void playTone('test', settings.volume);
  };

  const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const urgentRecent = recent.some((e) => e.urgent);

  // 버튼 하나로 상태를 구분한다: 정상(초록·울리는 벨) / 연결 중이거나 이 창의 소리를 껐음(노랑) / 끊김·오래됨(빨강).
  const problem = status === 'down' || stale;
  const connecting = status === 'connecting';
  const quiet = !soundOn; // 주소의 &sound=off로 이 창만 소리를 끈 상태
  const tone: 'ok' | 'warn' | 'bad' = problem ? 'bad' : connecting || quiet ? 'warn' : 'ok';
  const BellIcon = tone === 'ok' ? BellRing : Bell;
  const TONE_CLASS = {
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    warn: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
    bad: 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100',
  } as const;
  const statusText = status === 'live' ? '실시간' : status === 'down' ? '끊김' : '연결 중';
  const bellLabel = `알림 — ${statusText}${stale ? '(오래됨)' : ''}${quiet ? ', 이 창은 소리 꺼짐' : ''}${recent.length > 0 ? `, 확인하지 않은 변경 ${recent.length}건` : ''}`;

  // 주문표 위쪽 툴바 안에 들어가는 컨트롤이다(dashboard-client가 툴바 오른쪽에 놓는다). 화면에 떠 있게(fixed) 두면 표의 맨 아래 행을 가리고,
  // TV처럼 한 화면에 고정해서 보는 모드에서는 스크롤로도 피할 수 없어서 툴바로 옮겼다. 연결이 끊겼을 때의 전체 폭 경고 띠만 위에 고정한다.
  return (
    <>
      {status === 'down' && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-center font-bold py-2 text-base">
          실시간 연결이 끊겼습니다 — 15초마다 화면을 새로 받고 있습니다. 계속되면 인터넷을 확인해 주세요.
        </div>
      )}

      {soundOn && !audioRunning && (
        <button
          type="button"
          onClick={unlockSound}
          title="브라우저가 소리를 막고 있습니다 — 눌러서 켜기"
          className={`h-8 px-2.5 whitespace-nowrap flex-shrink-0 rounded-lg bg-amber-500 text-white text-xs font-bold shadow-sm hover:bg-amber-600 ${missed > 0 ? 'animate-pulse' : ''}`}
        >
          소리 켜기{missed > 0 ? ` · 놓침 ${missed}` : ''}
        </button>
      )}

      {soundOn && audioRunning && missed > 0 && (
        <button
          type="button"
          onClick={() => {
            setMissed(0);
            setMenuOpen(true);
          }}
          title="소리가 꺼진 동안 바뀐 주문이 있습니다 — 눌러서 최근 변경 보기"
          className="h-8 px-2.5 whitespace-nowrap flex-shrink-0 rounded-lg border border-amber-400 bg-amber-50 text-amber-800 text-xs font-bold shadow-sm hover:bg-amber-100"
        >
          놓친 변경 {missed}
        </button>
      )}

      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          aria-label={bellLabel}
          title={`${bellLabel} (눌러서 최근 변경 보기)`}
          className={`relative w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors ${TONE_CLASS[tone]}`}
        >
          <BellIcon className="w-4 h-4" />
          {/* 확인하지 않은 최근 변경 수. 패널을 열어 "모두 확인"을 누르면 사라진다. */}
          {recent.length > 0 && (
            <span className={`absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-black leading-4 text-white text-center ${urgentRecent ? 'bg-red-600' : 'bg-sky-600'}`}>{recent.length}</span>
          )}
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div role="dialog" aria-label="최근 변경 이력" className="absolute right-0 top-10 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-xl bg-white shadow-lg border border-slate-200 p-3 text-sm">
              <div className={`flex items-center gap-2 font-bold ${problem ? 'text-red-700' : 'text-slate-800'}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${status === 'live' && !stale ? 'bg-emerald-500' : problem ? 'bg-red-500' : 'bg-amber-400'}`} />
                <span>{statusText}</span>
                <span className="text-xs font-medium text-slate-500">· {lastRefreshAt ? `갱신 ${hhmm(lastRefreshAt)}` : '갱신 대기'}{stale ? ' (오래됨)' : ''}</span>
              </div>
              {quiet && <p className="mt-1 text-xs text-slate-500">이 창은 주소에 &amp;sound=off가 있어 소리가 나지 않습니다.</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">최근 변경</span>
                {recent.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecent([]);
                      setMissed(0);
                    }}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    모두 확인
                  </button>
                )}
              </div>
              {recent.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">확인하지 않은 변경이 없습니다.</p>
              ) : (
                <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto">
                  {recent.map((e, i) => (
                    <li key={`${e.at}-${i}`} className={`text-sm leading-snug rounded-md px-2 py-1 ${e.urgent ? 'bg-red-50 text-red-700 font-bold' : 'text-slate-700'}`}>
                      <span className="text-xs text-slate-400 mr-1">{hhmm(e.at)}</span>
                      {e.text}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
                <Link href="/dashboard/sound-test" onClick={() => setMenuOpen(false)} className="font-bold text-slate-500 hover:text-slate-800">
                  소리·알림 설정
                </Link>
                <Link href="/dashboard/pen-test" onClick={() => setMenuOpen(false)} className="font-bold text-slate-500 hover:text-slate-800">
                  펜 입력 진단
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
