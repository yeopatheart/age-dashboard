// 성능 계측 기록(perf_events)의 형식과 검증(순수 함수, 브라우저·서버 공용). 결정은 docs/decisions/2026-11-20-perf-telemetry.md.
// 고객명·주문 내용 같은 업무 데이터는 담지 않는다. 화면 이름, 기기 구분(모니터·터치·OS·창 크기), 배포 버전, 시간(ms)만 보낸다.

export const PERF_METRICS = ['load_block', 'nav', 'refresh'] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];

export type PerfMonitor = '1' | '2' | 'all';
export type PerfPointer = 'coarse' | 'fine';
export type PerfApi = 'loaf' | 'longtask';

export interface PerfEvent {
  metric: PerfMetric;
  /** load_block: 열린 뒤 10초 안에서 가장 길게 멈춘 시간. nav: 메뉴를 누른 뒤 새 화면이 그려지기까지. refresh: 화면 갱신(다시 받기) 한 번. */
  valueMs: number;
  /** load_block만: 같은 10초 동안 멈춘 시간의 합계. */
  extraMs: number | null;
  page: string;
  monitor: PerfMonitor | null;
  pointer: PerfPointer | null;
  platform: string | null;
  viewport: string | null;
  build: string | null;
  /** load_block만: 멈춤을 어떤 브라우저 기능으로 쟀는지(오래된 크롬은 longtask로 대체). */
  api: PerfApi | null;
}

export const MAX_EVENTS_PER_REQUEST = 40;
export const MAX_VALUE_MS = 600_000;
export const MAX_BODY_BYTES = 32_000;

const PAGE_PATTERN = /^[A-Za-z0-9/_:\-[\]]{1,64}$/;
const PLATFORM_PATTERN = /^[A-Za-z]{1,16}$/;
const VIEWPORT_PATTERN = /^\d{2,5}x\d{2,5}$/;
const BUILD_PATTERN = /^(?:[0-9a-f]{7}|local)$/;

/** /packing-log/123, /x/9f1c…(uuid) 같은 값 구간은 :id로 묶어 화면 종류별로 모이게 한다. */
export function normalizePagePath(pathname: string): string {
  const path = pathname
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? ':id' : seg))
    .join('/');
  return path.slice(0, 64) || '/';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function ms(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_VALUE_MS) return null;
  return Math.round(v);
}

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function matching(v: unknown, pattern: RegExp): string | null {
  return typeof v === 'string' && pattern.test(v) ? v : null;
}

/** 요청 본문을 검증한다. 형식이 틀리거나 한 번에 너무 많으면 null, 아니면 유효한 기록만(잘못된 기록은 건너뛰고) 돌려준다. */
export function parsePerfPayload(input: unknown): PerfEvent[] | null {
  if (!isRecord(input) || !Array.isArray(input.events)) return null;
  if (input.events.length === 0 || input.events.length > MAX_EVENTS_PER_REQUEST) return null;
  const out: PerfEvent[] = [];
  for (const raw of input.events) {
    if (!isRecord(raw)) continue;
    const metric = pick(raw.metric, PERF_METRICS);
    const valueMs = ms(raw.valueMs);
    const page = matching(raw.page, PAGE_PATTERN);
    if (!metric || valueMs === null || !page) continue;
    out.push({
      metric,
      valueMs,
      extraMs: raw.extraMs == null ? null : ms(raw.extraMs),
      page,
      monitor: pick(raw.monitor, ['1', '2', 'all'] as const),
      pointer: pick(raw.pointer, ['coarse', 'fine'] as const),
      platform: matching(raw.platform, PLATFORM_PATTERN),
      viewport: matching(raw.viewport, VIEWPORT_PATTERN),
      build: matching(raw.build, BUILD_PATTERN),
      api: pick(raw.api, ['loaf', 'longtask'] as const),
    });
  }
  return out;
}

/** perf_events 테이블에 넣을 행(열 이름은 DB 규칙). */
export function toPerfRow(e: PerfEvent) {
  return {
    metric: e.metric,
    value_ms: e.valueMs,
    extra_ms: e.extraMs,
    page: e.page,
    monitor: e.monitor,
    pointer: e.pointer,
    platform: e.platform,
    viewport: e.viewport,
    build: e.build,
    api: e.api,
  };
}
