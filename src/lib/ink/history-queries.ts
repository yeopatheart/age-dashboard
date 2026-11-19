// 필기 이력 화면이 서버에서 이력(board_ink_history)을 읽는 함수. 읽기 전용이다(이 화면은 어떤 것도 쓰지 않는다).
// 이 테이블은 공용 타입 정의(database.ts)에 없어서 타입 없는 클라이언트로 읽고, 받은 값은 하나씩 검증한다(any를 쓰지 않는다).
// 마이그레이션이 아직 없을 때(0067 테이블, 0068 열)는 화면이 죽지 않고 안내하도록 needsMigration으로 알린다.
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHistoryIndex, parseMeta, parseSummary, type HistoryIndex, type SnapshotMeta, type SummaryCard } from './history-view.ts';
import { parseInkStrokes, type InkStroke } from './store.ts';

export type Reason = 'interval' | 'drop';

export interface SnapshotInfo {
  id: number;
  monitor: string; // '1' | '2' | 's1' | 's2' …
  reason: Reason;
  strokeCount: number;
  pointCount: number;
  prevPointCount: number | null; // 급감(drop) 때 직전 점 수
  newPointCount: number | null; // 급감(drop) 때 직후 점 수
  strokesSavedAt: string;
  capturedAt: string;
  summaryVersion: number; // 1 = 옛 형식, 2 = 표를 다시 그릴 수 있는 요약
}

export interface Snapshot {
  strokes: InkStroke[];
  cards: SummaryCard[] | null; // 요약을 만들지 못한 스냅샷은 null
  meta: SnapshotMeta;
}

export type Result<T> = { ok: true; value: T } | { ok: false; needsMigration: boolean; message: string };

const MIGRATION_HINT = /board_ink_history|summary_version|prev_point_count|new_point_count|rows_summary/;
const MISSING = /does not exist|schema cache|Could not find/i;

export const needsMigration = (message: string): boolean => MIGRATION_HINT.test(message) && MISSING.test(message);

const fail = <T>(message: string): Result<T> => ({ ok: false, needsMigration: needsMigration(message), message });

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseSnapshotInfo(raw: unknown): SnapshotInfo | null {
  if (!isRec(raw)) return null;
  const id = intOrNull(raw.id);
  if (id === null || (raw.reason !== 'interval' && raw.reason !== 'drop')) return null;
  if (typeof raw.captured_at !== 'string' || typeof raw.strokes_saved_at !== 'string' || typeof raw.monitor !== 'string') return null;
  return {
    id,
    monitor: raw.monitor,
    reason: raw.reason,
    strokeCount: intOrNull(raw.stroke_count) ?? 0,
    pointCount: intOrNull(raw.point_count) ?? 0,
    prevPointCount: intOrNull(raw.prev_point_count),
    newPointCount: intOrNull(raw.new_point_count),
    strokesSavedAt: raw.strokes_saved_at,
    capturedAt: raw.captured_at,
    summaryVersion: intOrNull(raw.summary_version) ?? 1,
  };
}

const SNAPSHOT_COLUMNS = 'id, monitor, reason, stroke_count, point_count, prev_point_count, new_point_count, strokes_saved_at, captured_at, summary_version';
const INDEX_LIMIT = 2000; // 보관 7일의 가벼운 열만 읽는 상한(날짜·모니터 목록용)
const DAY_LIMIT = 600; // 하루 모든 화면의 스냅샷(정기 30분 간격 × 화면 수 + 급감)이 들어가는 상한

// 이력이 있는 날짜·모니터. 획·요약은 읽지 않는다.
export async function fetchHistoryIndex(db: SupabaseClient): Promise<Result<HistoryIndex>> {
  const { data, error } = await db.from('board_ink_history').select('order_date, monitor').order('captured_at', { ascending: false }).limit(INDEX_LIMIT);
  if (error) return fail(error.message);
  const rows: unknown = data;
  const list = Array.isArray(rows) ? rows.filter(isRec).flatMap((r) => (typeof r.order_date === 'string' && typeof r.monitor === 'string' ? [{ order_date: r.order_date, monitor: r.monitor }] : [])) : [];
  return { ok: true, value: buildHistoryIndex(list) };
}

// 한 날짜의 모든 화면 스냅샷 목록(최신순). 획·요약은 읽지 않아 가볍다. 시각 목록과 "그 시각에 존재한 화면"을 이것으로 계산한다.
export async function fetchDaySnapshots(db: SupabaseClient, date: string): Promise<Result<SnapshotInfo[]>> {
  const { data, error } = await db.from('board_ink_history').select(SNAPSHOT_COLUMNS).eq('order_date', date).order('captured_at', { ascending: false }).order('id', { ascending: false }).limit(DAY_LIMIT);
  if (error) return fail(error.message);
  const rows: unknown = data;
  return { ok: true, value: Array.isArray(rows) ? rows.flatMap((r) => { const info = parseSnapshotInfo(r); return info ? [info] : []; }) : [] };
}

// 스냅샷 한 건의 획·요약·색. 고른 한 건만 읽는다.
export async function fetchSnapshot(db: SupabaseClient, id: number): Promise<Result<Snapshot | null>> {
  const { data, error } = await db.from('board_ink_history').select('strokes, rows_summary, meta').eq('id', id).maybeSingle();
  if (error) return fail(error.message);
  const row: unknown = data;
  if (!isRec(row)) return { ok: true, value: null };
  return { ok: true, value: { strokes: parseInkStrokes(row.strokes), cards: parseSummary(row.rows_summary), meta: parseMeta(row.meta) } };
}
