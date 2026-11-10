// 운영 시간 집계(순수 함수). 작업 시작 시각은 저장되지 않아 "작업 자체의 소요 시간"은 알 수 없고, 단계마다 남는 시각으로 두 가지를 잰다:
//  - 하루 작업 구간: 그날 그 단계에서 첫 이벤트부터 마지막 완료까지(중간에 쉬는 시간도 포함한다)
//  - 카드 단위 리드타임: 한 업체 카드가 단계에서 단계로 넘어가는 데 걸린 분
// 시각은 모두 epoch 밀리초로 다루고, 화면 표시용 "하루 시작 기준 분"(KST)은 minutesFromDayStart가 만든다.
import { isCardComplete } from '../orders.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export type StageKey = 'box' | 'label' | 'pack' | 'load';
export const STAGE_ORDER: StageKey[] = ['box', 'label', 'pack', 'load'];
export const STAGE_LABEL: Record<StageKey, string> = { box: '박스 할당', label: '라벨 출력', pack: '포장', load: '상차' };

export interface OpsLabel {
  firstPrintAt: number | null; // 이 박스 라벨을 처음 출력한 시각(재출력은 제외)
  loadedAt: number | null; // 상차 스캔 시각(되돌리면 null)
}

export interface OpsItem {
  changeStatus: 'new' | 'modified' | 'cancelled' | 'none';
  isPacked: boolean;
  quantity: number;
  unit: string;
  unshippedQuantity: number;
  packedAt: number | null;
}

export interface OpsCardInput {
  id: string;
  orderDate: string; // 출고일 YYYY-MM-DD
  name: string;
  terminal: string;
  parcel: boolean; // 택배 터미널: 라벨·상차가 없고 포장으로 끝난다
  boxCount: number | null; // 제출한 박스 수
  submittedAt: number | null; // 박스 할당 제출 시각(제출 이력의 최초 제출이 있으면 그것, 없으면 마지막 제출)
  labels: OpsLabel[];
  items: OpsItem[];
}

export interface StageTimes {
  start: number | null; // 그 단계의 첫 이벤트
  end: number | null; // 그 단계를 마친 시각(끝나지 않았으면 null)
}

export type CardTimes = Record<StageKey, StageTimes>;

const max = (xs: number[]): number | null => (xs.length === 0 ? null : Math.max(...xs));
const min = (xs: number[]): number | null => (xs.length === 0 ? null : Math.min(...xs));
const present = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

// 카드 한 장의 단계별 시작·완료 시각.
//  - 박스 할당: 제출 시각(시작=끝)
//  - 라벨 출력: 첫 출력 ~ 모든 박스 라벨이 처음 출력된 시각(라벨이 제출한 박스 수만큼 아직 안 생겼으면 끝나지 않은 것)
//  - 포장: 첫 포장 체크 ~ 모든 상품이 끝난 뒤 가장 늦은 포장 체크(isCardComplete는 대시보드와 같은 판정)
//  - 상차: 첫 스캔 ~ 모든 박스가 상차된 시각
export function cardTimes(card: OpsCardInput): CardTimes {
  const date = card.orderDate;
  const none: StageTimes = { start: null, end: null };
  const submitted = inRange(card.submittedAt, date);
  const box: StageTimes = { start: submitted, end: submitted };

  // 포장 완료 시각은 포장 체크된 모든 상품의 시각을 알 때만 정한다(시각이 없거나 범위 밖인 상품이 있으면 알 수 없다).
  const packedItems = card.items.filter((i) => i.changeStatus !== 'cancelled' && i.isPacked);
  const packedTimes = present(packedItems.map((i) => inRange(i.packedAt, date)));
  const packComplete = isCardComplete(card.items);
  const pack: StageTimes = { start: min(packedTimes), end: packComplete && packedTimes.length === packedItems.length ? max(packedTimes) : null };

  if (card.parcel) return { box, label: none, pack, load: none };

  const expected = Math.max(card.boxCount ?? 0, card.labels.length);
  const printed = card.labels.map((l) => inRange(l.firstPrintAt, date));
  const loaded = card.labels.map((l) => inRange(l.loadedAt, date));
  const allLabelled = expected > 0 && card.labels.length >= expected && printed.every((t) => t !== null);
  const printTimes = present(printed);
  const label: StageTimes = { start: min(printTimes), end: allLabelled ? max(printTimes) : null };

  const allLoaded = expected > 0 && card.labels.length >= expected && loaded.every((t) => t !== null);
  const loadTimes = present(loaded);
  const load: StageTimes = { start: min(loadTimes), end: allLoaded ? max(loadTimes) : null };

  return { box, label, pack, load };
}

// ─── 시각 표시 ──────────────────────────────────────────────────────────────
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 출고일 0시(KST)의 epoch 밀리초.
export const dayStartMs = (date: string): number => Date.parse(`${date}T00:00:00Z`) - KST_OFFSET_MS;

// 그 시각이 출고일 0시(KST)로부터 몇 분째인지. 자정을 넘기면 1440 이상이 된다.
export const minutesFromDayStart = (ms: number, date: string): number => (ms - dayStartMs(date)) / 60000;

// "14:05", 자정을 넘기면 "익일 00:30".
export function formatClock(minutes: number): string {
  const total = Math.round(minutes);
  const dayOffset = Math.floor(total / 1440);
  const m = ((total % 1440) + 1440) % 1440;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return dayOffset >= 1 ? `익일 ${hhmm}` : dayOffset < 0 ? `전일 ${hhmm}` : hhmm;
}

// 분 → "1시간 25분" / "45분" / "-".
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '-';
  const m = Math.round(minutes);
  if (m < 60) return `${m}분`;
  return m % 60 === 0 ? `${m / 60}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

export { DAY_MS };

// 당일 작업으로 보는 범위: 출고일 0시(KST) 기준 12시간 전부터 36시간 후(= 전날 정오 ~ 다음날 정오)까지.
// 며칠 뒤에 소급해서 넣은 기록(테스트·정정)이 하루 시각 축과 평균을 왜곡하지 않게, 범위 밖 시각은 "알 수 없음"으로 본다.
const SAME_DAY_FROM_MS = -12 * 60 * 60 * 1000;
const SAME_DAY_TO_MS = 36 * 60 * 60 * 1000;
export const inSameDayWindow = (ms: number, date: string): boolean => {
  const offset = ms - dayStartMs(date);
  return offset >= SAME_DAY_FROM_MS && offset <= SAME_DAY_TO_MS;
};
const inRange = (ms: number | null, date: string): number | null => (ms !== null && inSameDayWindow(ms, date) ? ms : null);

// 당일 범위 밖의 시각이 하나라도 있는 카드 수(소급 입력 등). 화면에 "그 시각은 뺐다"고 알리는 용도다.
export function countOutOfRange(cards: OpsCardInput[]): number {
  return cards.filter((c) => {
    const times = [c.submittedAt, ...c.items.map((i) => (i.isPacked ? i.packedAt : null)), ...c.labels.flatMap((l) => [l.firstPrintAt, l.loadedAt])];
    return times.some((t) => t !== null && !inSameDayWindow(t, c.orderDate));
  }).length;
}

// ─── 하루 단위 ─────────────────────────────────────────────────────────────
export interface DayStage {
  start: number | null; // 그날 그 단계의 첫 이벤트
  end: number | null; // 그날 완료된 카드 중 가장 늦은 완료
  done: number; // 완료한 카드 수
  total: number; // 그 단계를 거치는 카드 수(택배는 라벨·상차에서 빠진다)
}

export interface DayOps {
  date: string;
  cards: number;
  boxes: number;
  stages: Record<StageKey, DayStage>;
}

const appliesTo = (stage: StageKey, card: OpsCardInput): boolean => !(card.parcel && (stage === 'label' || stage === 'load'));

export function summarizeDays(cards: OpsCardInput[]): DayOps[] {
  const byDate = new Map<string, OpsCardInput[]>();
  for (const c of cards) byDate.set(c.orderDate, [...(byDate.get(c.orderDate) ?? []), c]);
  return [...byDate].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, list]) => {
    const times = list.map((c) => ({ card: c, t: cardTimes(c) }));
    const stages = Object.fromEntries(
      STAGE_ORDER.map((stage) => {
        const applicable = times.filter(({ card }) => appliesTo(stage, card));
        return [
          stage,
          {
            start: min(present(applicable.map(({ t }) => t[stage].start))),
            end: max(present(applicable.map(({ t }) => t[stage].end))),
            done: applicable.filter(({ t }) => t[stage].end !== null).length,
            total: applicable.length,
          },
        ];
      }),
    ) as Record<StageKey, DayStage>;
    return { date, cards: list.length, boxes: list.reduce((sum, c) => sum + (c.boxCount ?? 0), 0), stages };
  });
}

// 하루 작업 구간 길이(분). 시작과 끝이 모두 있어야 한다.
export const windowMinutes = (s: DayStage): number | null => (s.start !== null && s.end !== null && s.end >= s.start ? (s.end - s.start) / 60000 : null);

// ─── 카드 단위 리드타임 ─────────────────────────────────────────────────────
export type IntervalKey = 'box-label' | 'label-pack' | 'pack-load' | 'box-load';
export const INTERVALS: { key: IntervalKey; label: string; from: StageKey; to: StageKey }[] = [
  { key: 'box-label', label: '제출 → 라벨 출력 완료', from: 'box', to: 'label' },
  { key: 'label-pack', label: '라벨 출력 완료 → 포장 완료', from: 'label', to: 'pack' },
  { key: 'pack-load', label: '포장 완료 → 상차 완료', from: 'pack', to: 'load' },
  { key: 'box-load', label: '제출 → 상차 완료 (전체)', from: 'box', to: 'load' },
];

export interface IntervalStat {
  key: IntervalKey;
  label: string;
  n: number; // 계산에 쓴 카드 수
  skippedOrder: number; // 단계 순서가 바뀌어(음수) 뺀 카드 수
  median: number | null;
  mean: number | null;
  p90: number | null;
  max: number | null;
}

// 최근접 순위법 백분위. 값이 없으면 null.
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function leadTimeStats(cards: OpsCardInput[]): IntervalStat[] {
  const times = cards.filter((c) => !c.parcel).map((c) => cardTimes(c));
  return INTERVALS.map(({ key, label, from, to }) => {
    const values: number[] = [];
    let skippedOrder = 0;
    for (const t of times) {
      const a = t[from].end;
      const b = t[to].end;
      if (a === null || b === null) continue; // 끝나지 않은 단계는 뺀다
      if (b < a) skippedOrder += 1;
      else values.push((b - a) / 60000);
    }
    const sorted = [...values].sort((x, y) => x - y);
    return {
      key,
      label,
      n: values.length,
      skippedOrder,
      median: sorted.length === 0 ? null : round1(percentile(sorted, 50) as number),
      mean: sorted.length === 0 ? null : round1(values.reduce((s, v) => s + v, 0) / values.length),
      p90: sorted.length === 0 ? null : round1(percentile(sorted, 90) as number),
      max: sorted.length === 0 ? null : round1(sorted[sorted.length - 1]),
    };
  });
}

// 단계 사이 세 구간(전체 제외) 중 중앙값이 가장 긴 구간 = 병목. 표본이 없으면 null.
export function bottleneck(stats: IntervalStat[]): IntervalStat | null {
  const parts = stats.filter((s) => s.key !== 'box-load' && s.median !== null);
  if (parts.length === 0) return null;
  return parts.reduce((best, s) => ((s.median as number) > (best.median as number) ? s : best));
}

export interface SlowCard {
  id: string;
  orderDate: string;
  name: string;
  terminal: string;
  minutes: number; // 제출 → 상차 완료
}

export function slowestCards(cards: OpsCardInput[], limit = 10): SlowCard[] {
  const out: SlowCard[] = [];
  for (const c of cards) {
    if (c.parcel) continue;
    const t = cardTimes(c);
    if (t.box.end === null || t.load.end === null || t.load.end < t.box.end) continue;
    out.push({ id: c.id, orderDate: c.orderDate, name: c.name, terminal: c.terminal, minutes: round1((t.load.end - t.box.end) / 60000) });
  }
  return out.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'ko')).slice(0, limit);
}

// ─── 터미널별 상차 완료 시각 ────────────────────────────────────────────────
export interface TerminalLoadStat {
  terminal: string;
  days: number; // 상차를 마친 날 수
  incompleteDays: number; // 그 터미널의 박스가 다 상차되지 않아 뺀 날 수
  median: number; // 상차 완료 시각의 중앙값(하루 시작 기준 분)
  latest: number; // 가장 늦은 상차 완료 시각(분)
  latestDate: string;
  medianBoxes: number; // 그 날들의 박스 수 중앙값
}

export function terminalLoadStats(cards: OpsCardInput[]): TerminalLoadStat[] {
  const groups = new Map<string, OpsCardInput[]>(); // `${터미널}|${날짜}` → 카드(택배 제외)
  for (const c of cards) {
    if (c.parcel) continue;
    const key = `${c.terminal}\u0000${c.orderDate}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const byTerminal = new Map<string, { minutes: number; date: string; boxes: number }[]>();
  const incomplete = new Map<string, number>();
  for (const [key, list] of groups) {
    const [terminal, date] = key.split('\u0000');
    const boxes = list.reduce((s, c) => s + (c.boxCount ?? 0), 0);
    // 박스가 있는 카드가 하나도 상차를 못 끝냈거나 일부만 끝났으면 그날은 "완료"가 아니다.
    const withBoxes = list.filter((c) => (c.boxCount ?? 0) > 0 || c.labels.length > 0);
    if (withBoxes.length === 0) continue;
    const doneEnds = present(withBoxes.map((c) => cardTimes(c).load.end));
    if (doneEnds.length < withBoxes.length) {
      incomplete.set(terminal, (incomplete.get(terminal) ?? 0) + 1);
      continue;
    }
    byTerminal.set(terminal, [...(byTerminal.get(terminal) ?? []), { minutes: minutesFromDayStart(Math.max(...doneEnds), date), date, boxes }]);
  }
  const terminals = new Set([...byTerminal.keys(), ...incomplete.keys()]);
  const out: TerminalLoadStat[] = [];
  for (const terminal of terminals) {
    const days = byTerminal.get(terminal) ?? [];
    if (days.length === 0) continue;
    const sorted = days.map((d) => d.minutes).sort((a, b) => a - b);
    const latest = days.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    const boxSorted = days.map((d) => d.boxes).sort((a, b) => a - b);
    out.push({
      terminal,
      days: days.length,
      incompleteDays: incomplete.get(terminal) ?? 0,
      median: percentile(sorted, 50) as number,
      latest: latest.minutes,
      latestDate: latest.date,
      medianBoxes: percentile(boxSorted, 50) as number,
    });
  }
  return out.sort((a, b) => b.median - a.median || a.terminal.localeCompare(b.terminal, 'ko'));
}
