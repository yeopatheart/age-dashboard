// 성능 계측(브라우저 전용). instrumentation-client.ts가 startPerf()를 부르고, 메뉴 이동은 onTransitionStart/onPathnameCommitted,
// 화면 갱신은 recordRefreshDuration으로 기록한다. 모은 기록은 1분마다·창을 닫을 때 /api/perf로 보낸다. 결정: docs/decisions/2026-11-20-perf-telemetry.md
// 계측은 화면을 방해하면 안 된다: 모든 진입점은 오류를 삼키고, 서버가 그만 보내라고 하면(perfEnabled=false) 이 화면에서는 멈춘다.
import { createCollector, type SendResult } from './perf-collector.ts';
import { summarizeFreezes, type FreezeEntry } from './perf-freeze.ts';
import { normalizePagePath, type PerfApi, type PerfEvent, type PerfMonitor } from './perf-payload.ts';

const WINDOW_MS = 10_000; // 화면이 열린 뒤 이 시간 동안의 멈춤을 잰다
const FLUSH_MS = 60_000;
const NAV_STALE_MS = 30_000;
const MAX_FREEZE_ENTRIES = 500;

async function send(events: PerfEvent[]): Promise<SendResult> {
  try {
    const res = await fetch('/api/perf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
      credentials: 'same-origin',
    });
    if (!res.ok || res.redirected) return 'failed'; // 세션이 끊겨 로그인으로 보내진 경우 포함
    const body = (await res.json().catch(() => null)) as { enabled?: boolean } | null;
    return body?.enabled === false ? 'disabled' : 'ok';
  } catch {
    return 'failed';
  }
}

const collector = createCollector(send);

let started = false;
let api: PerfApi | null = null;
let observer: PerformanceObserver | null = null;
const freezes: FreezeEntry[] = [];
let view: { path: string; monitor: PerfMonitor | null; startedAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
let pendingNavAt: number | null = null;

function monitorOf(url: URL): PerfMonitor | null {
  if (url.pathname !== '/dashboard') return null; // 모니터 1·2·전체는 주문 목록만의 개념이다
  const m = url.searchParams.get('monitor');
  return m === '2' ? '2' : m === 'all' ? 'all' : '1';
}

function platformOf(): string | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const ua = `${nav.userAgentData?.platform ?? ''} ${navigator.userAgent}`;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Linux|CrOS/i.test(ua)) return 'Linux';
  return null;
}

function record(partial: Pick<PerfEvent, 'metric' | 'valueMs' | 'extraMs' | 'page' | 'monitor' | 'api'>) {
  try {
    if (location.pathname.startsWith('/login')) return; // 로그인 전에는 서버가 받지 않는다
    collector.push({
      ...partial,
      pointer: window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
      platform: platformOf(),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      build: process.env.NEXT_PUBLIC_BUILD_SHA ?? null,
    });
  } catch {
    // 계측 실패는 무시한다
  }
}

function drainObserver() {
  try {
    for (const e of observer?.takeRecords() ?? []) pushFreeze(e);
  } catch {
    // 무시
  }
}

function pushFreeze(e: PerformanceEntry) {
  const blocking = api === 'loaf' ? ((e as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0) : Math.max(0, e.duration - 50);
  freezes.push({ startTime: e.startTime, duration: e.duration, blockingDuration: blocking });
  if (freezes.length > MAX_FREEZE_ENTRIES) freezes.splice(0, freezes.length - MAX_FREEZE_ENTRIES);
}

function observeFreezes() {
  const types = PerformanceObserver.supportedEntryTypes ?? [];
  const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
  if (!type) return; // 멈춤을 잴 수 없는 브라우저는 열릴 때 멈춤 기록을 남기지 않는다(다른 두 항목은 그대로)
  api = type === 'long-animation-frame' ? 'loaf' : 'longtask';
  observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) pushFreeze(e);
  });
  observer.observe({ type, buffered: true });
}

function startView(url: URL, startedAt: number) {
  const remaining = Math.max(0, WINDOW_MS - (performance.now() - startedAt));
  view = { path: normalizePagePath(url.pathname), monitor: monitorOf(url), startedAt, timer: setTimeout(finishView, remaining) };
}

/** 지금 보던 화면의 "열릴 때 멈춤"을 확정해 기록한다(10초가 지났거나, 다른 화면으로 가거나, 창이 가려질 때). */
function finishView() {
  const v = view;
  view = null;
  if (!v || !api) return;
  clearTimeout(v.timer);
  drainObserver();
  const to = Math.min(performance.now(), v.startedAt + WINDOW_MS);
  const { maxMs, blockedMs } = summarizeFreezes(freezes, v.startedAt, to);
  record({ metric: 'load_block', valueMs: maxMs, extraMs: blockedMs, page: v.path, monitor: v.monitor, api });
}

function flushByBeacon() {
  try {
    for (const batch of collector.drain()) {
      navigator.sendBeacon('/api/perf', new Blob([JSON.stringify({ events: batch })], { type: 'application/json' }));
    }
  } catch {
    // 무시
  }
}

export function startPerf() {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    observeFreezes();
    startView(new URL(location.href), 0); // 처음 열기: 페이지가 열린 시점(timeOrigin)부터
    setInterval(() => void collector.flush(), FLUSH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      finishView();
      flushByBeacon();
    });
    window.addEventListener('pagehide', () => {
      finishView();
      flushByBeacon();
    });
  } catch {
    // 계측을 시작하지 못해도 화면은 그대로 쓴다
  }
}

/** 메뉴·링크로 이동을 시작할 때(instrumentation-client의 onRouterTransitionStart). */
export function onTransitionStart(url: string) {
  try {
    finishView();
    pendingNavAt = performance.now();
    startView(new URL(url, location.href), pendingNavAt);
  } catch {
    // 무시
  }
}

/** 화면 경로가 바뀐 것이 반영됐을 때(PerfProbe). 다음 두 프레임 뒤를 "새 화면이 그려진 시점"으로 본다. */
export function onPathnameCommitted(pathname: string) {
  try {
    const at = pendingNavAt;
    pendingNavAt = null;
    if (at === null || performance.now() - at > NAV_STALE_MS) return;
    const page = normalizePagePath(pathname);
    const monitor = monitorOf(new URL(location.href));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => record({ metric: 'nav', valueMs: Math.round(performance.now() - at), extraMs: null, page, monitor, api: null })),
    );
  } catch {
    // 무시
  }
}

/** 실시간 갱신(다시 받기) 한 번이 끝났을 때(use-live-refresh). */
export function recordRefreshDuration(ms: number) {
  try {
    record({ metric: 'refresh', valueMs: Math.round(ms), extraMs: null, page: normalizePagePath(location.pathname), monitor: monitorOf(new URL(location.href)), api: null });
  } catch {
    // 무시
  }
}
