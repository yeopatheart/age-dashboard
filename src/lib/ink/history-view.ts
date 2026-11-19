// 필기 이력 화면(/dashboard/history)이 쓰는 순수 함수. 주문 목록·필기 코드와 따로 쓰고, 이 파일에서 그쪽을 바꾸지 않는다.
// 이력 행(board_ink_history)의 rows_summary·meta(JSON)를 화면 데이터로 읽고, 목록에 보일 글자(시각·급감 비율)를 만든다.
// 값은 DB가 준 것이라 믿지 않고 하나씩 좁혀 읽는다(옛 형식 v1은 터미널·박스·물봉 등이 없다).
import { isCardCancelled, isCardComplete, isUndecidedQuantity, type OrderItem } from '../orders.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export type ItemStatus = 'new' | 'modified' | 'cancelled' | 'none';

export interface SummaryItem {
  id: string;
  seq: number;
  name: string;
  qty: number;
  unit: string;
  size: string | null;
  status: ItemStatus;
  packed: boolean;
  unshipped: number; // 미출고 수량(v1은 0)
  unshippedReason: string | null;
  isMulbong: boolean;
  hasAerator: boolean;
}

export interface SummaryCard {
  id: string;
  number: number; // 발급 번호(라벨 번호). 화면 번호는 cardNumberLabels로 다시 센다
  name: string;
  businessId: string | null; // 1차·2차 구분용(v1은 없다)
  round: 1 | 2;
  terminal: string; // v1은 빈 글자
  separate: boolean;
  parcel: boolean;
  totalBoxes: number | null;
  items: SummaryItem[];
}

export interface TerminalColor {
  fill: string | null;
  border: string | null;
}

export interface SnapshotMeta {
  terminals: Record<string, TerminalColor>;
  products: Record<string, TerminalColor>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown): boolean => v === true;

const STATUSES: readonly ItemStatus[] = ['new', 'modified', 'cancelled', 'none'];

function parseItem(raw: unknown): SummaryItem | null {
  if (!isRec(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  const status = STATUSES.find((s) => s === raw.status) ?? 'none';
  return {
    id: raw.id,
    seq: num(raw.seq),
    name: str(raw.name),
    qty: num(raw.qty),
    unit: str(raw.unit),
    size: strOrNull(raw.size),
    status,
    packed: bool(raw.packed),
    unshipped: num(raw.unshipped_qty),
    unshippedReason: strOrNull(raw.unshipped_reason),
    isMulbong: bool(raw.mulbong),
    hasAerator: bool(raw.aerator),
  };
}

function parseCard(raw: unknown): SummaryCard | null {
  if (!isRec(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem).filter((i): i is SummaryItem => i !== null) : [];
  const boxes = raw.total_boxes;
  return {
    id: raw.id,
    number: num(raw.number),
    name: str(raw.name),
    businessId: strOrNull(raw.business_id),
    round: raw.round === 2 ? 2 : 1,
    terminal: str(raw.terminal),
    separate: bool(raw.separate),
    parcel: bool(raw.parcel),
    totalBoxes: typeof boxes === 'number' && Number.isFinite(boxes) ? boxes : null,
    items,
  };
}

// rows_summary(JSON) → 카드 목록. 배열이 아니면(요약을 못 만든 스냅샷은 null) null. 읽을 수 없는 카드·상품은 건너뛴다.
export function parseSummary(data: unknown): SummaryCard[] | null {
  if (!Array.isArray(data)) return null;
  return data.map(parseCard).filter((c): c is SummaryCard => c !== null);
}

function parseColorMap(data: unknown): Record<string, TerminalColor> {
  const out: Record<string, TerminalColor> = {};
  if (!isRec(data)) return out;
  for (const [name, value] of Object.entries(data)) {
    if (!isRec(value)) continue;
    out[name] = { fill: strOrNull(value.fill), border: strOrNull(value.border) };
  }
  return out;
}

// meta(JSON) → 색 정보. 없으면(옛 형식) 빈 색 정보(기본 모양).
export function parseMeta(data: unknown): SnapshotMeta {
  if (!isRec(data)) return { terminals: {}, products: {} };
  return { terminals: parseColorMap(data.terminals), products: parseColorMap(data.products) };
}

// 표의 상품 열 수: 한 업체의 상품 줄 수 중 가장 큰 값(칠판과 같은 규칙, 최소 1).
export const productSlotCount = (cards: readonly SummaryCard[]): number => Math.max(1, ...cards.map((c) => c.items.length));

// 칠판 줄과 같은 열 순서(No · 터미널 · 고객명 · 박스 · 상품 1..N)의 grid. 필기는 "몇 번째 열인지"로 줄에 환산되므로 앞의 4열이 같아야 한다.
export const boardGridTemplate = (slots: number): string => `44px 76px minmax(150px, 1.3fr) 64px repeat(${slots}, minmax(104px, 1fr))`;

// 같은 업체가 1차·2차 모두 있으면 그 업체의 카드에 1차/2차 표시를 한다(v1처럼 업체 id가 없으면 표시하지 않는다).
export function businessIdsInBothRounds(cards: readonly SummaryCard[]): Set<string> {
  const rounds = new Map<string, Set<number>>();
  for (const c of cards) {
    if (!c.businessId) continue;
    const set = rounds.get(c.businessId) ?? new Set<number>();
    set.add(c.round);
    rounds.set(c.businessId, set);
  }
  return new Set([...rounds].filter(([, set]) => set.size > 1).map(([id]) => id));
}

// 대시보드의 완료·취소 판정(orders.ts)을 그대로 쓰기 위한 변환.
const toLive = (items: readonly SummaryItem[]): Pick<OrderItem, 'changeStatus' | 'isPacked' | 'quantity' | 'unit' | 'unshippedQuantity'>[] =>
  items.map((i) => ({ changeStatus: i.status, isPacked: i.packed, quantity: i.qty, unit: i.unit, unshippedQuantity: i.unshipped }));

export const cardIsComplete = (card: SummaryCard): boolean => isCardComplete(toLive(card.items));
export const cardIsCancelled = (card: SummaryCard): boolean => isCardCancelled(toLive(card.items));
export const itemIsUndecided = (item: SummaryItem): boolean => isUndecidedQuantity({ quantity: item.qty, unit: item.unit });

// 이력이 있는 날짜(최신순)와 날짜별 모니터(1, 2, s1, s2… 순). rows는 이력 행의 가벼운 열만 있으면 된다.
export interface HistoryIndex {
  dates: string[];
  monitorsByDate: Record<string, string[]>;
}

export const monitorRank = (m: string): number => (m === '1' ? 1 : m === '2' ? 2 : 100 + (Number(m.slice(1)) || 0));

export function buildHistoryIndex(rows: readonly { order_date: string; monitor: string }[]): HistoryIndex {
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byDate.get(r.order_date) ?? new Set<string>();
    set.add(r.monitor);
    byDate.set(r.order_date, set);
  }
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const monitorsByDate: Record<string, string[]> = {};
  for (const [date, set] of byDate) monitorsByDate[date] = [...set].sort((a, b) => monitorRank(a) - monitorRank(b));
  return { dates, monitorsByDate };
}

// 화면 두 묶음: 버스 주문(모니터 1·2)과 별도 주문(별도 1·2 = s1·s2). 1·2가 아닌 모니터는 별도 주문으로 본다.
export type BoardGroup = 'bus' | 'sep';
export const groupOfMonitor = (monitor: string): BoardGroup => (monitor === '1' || monitor === '2' ? 'bus' : 'sep');
export const groupLabel = (group: BoardGroup): string => (group === 'bus' ? '버스 주문' : '별도 주문');
// 묶음에 속한 카드만(별도 주문 탭은 별도·택배 카드, 버스 주문 탭은 그 나머지).
export const cardsOfGroup = <C extends { separate: boolean; parcel: boolean }>(cards: readonly C[], group: BoardGroup): C[] => cards.filter((c) => (c.separate || c.parcel) === (group === 'sep'));

// 한국 시간 "MM-DD HH:mm" (목록용). 읽을 수 없는 값은 빈 글자.
export function formatKst(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16);
}

// 스냅샷의 필기와 요약 시각이 얼마나 어긋날 수 있는지(분). 정기(interval) 스냅샷은 같은 순간이라 어긋나지 않는다.
// 옛 형식(v1)과 급감(drop) 스냅샷은 필기가 직전 저장본이고 요약은 만든 시점이라 저장 시각과 만든 시각의 차이만큼 어긋날 수 있다.
export function driftMinutes(reason: string, summaryVersion: number, savedAt: string, capturedAt: string): number | null {
  if (reason === 'interval' && summaryVersion >= 2) return null;
  const diff = new Date(capturedAt).getTime() - new Date(savedAt).getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return null; // 1분 안이면 알릴 만큼 어긋나지 않는다
  return Math.round(diff / 60_000);
}

// 한국 시간 "HH:mm" (시각 목록용). 읽을 수 없는 값은 빈 글자.
export function kstTime(ms: number): string {
  const t = new Date(ms);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(11, 16);
}
