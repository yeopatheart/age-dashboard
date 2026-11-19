import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertTriangle, ArrowLeft, History as HistoryIcon, Info, TriangleAlert } from 'lucide-react';
import { Segmented } from '@/components/segmented';
import { fetchDaySnapshots, fetchHistoryIndex, fetchSnapshot } from '@/lib/ink/history-queries';
import { buildTimePoints, groupSnapshotsAt, groupsAt } from '@/lib/ink/history-timeline';
import { cardsOfGroup, driftMinutes, formatKst, groupLabel, kstTime, type BoardGroup } from '@/lib/ink/history-view';
import { todayKST } from '@/lib/order-date';
import { requireMenu } from '@/lib/permissions/access';
import { createClient } from '@/lib/supabase/server';
import { TimeList, type TimeItem } from './history-nav';
import { HistoryViewer } from './history-viewer';

// 칠판 필기 이력 보기(읽기 전용). 주문 목록·필기와 따로 동작하고 이 화면은 어떤 것도 쓰지 않는다.
// 흐름: 날짜(이력이 있는 날 칩) → 왼쪽 시각 목록(정기 스냅샷과 급감 스냅샷을 분 단위로 묶음) → 오른쪽에서 버스 주문(모니터 1·2)·별도 주문(별도 1·2) 탭을 골라 본다.
// 한 탭은 그 묶음의 카드만 한 표에 그리고 두 화면의 필기를 합쳐 얹는다.
// 이력은 최근 N영업일(설정, 기본 2) 보관: docs/decisions/2026-11-18-board-ink-history-v2.md, 화면 결정: docs/decisions/2026-11-19-board-ink-history-viewer.md

const href = (date: string, t?: number, group?: BoardGroup) => `/dashboard/history?date=${date}${t !== undefined ? `&t=${t}` : ''}${group ? `&g=${group}` : ''}`;
const SUM_PREFIX = 'sum:';

// 날짜 칩: 이력이 있는 날짜(최신순). 오늘과 그 앞의 가장 가까운 날(이전 영업일)에는 이름을 붙인다.
function dateItems(dates: string[], today: string) {
  const previous = dates.find((d) => d < today);
  return dates.map((d) => ({ key: d, label: `${d === today ? '오늘 ' : d === previous ? '이전 영업일 ' : ''}${d.slice(5).replace('-', '/')}`, href: href(d) }));
}

function Shell({ dates, date, today, count, children }: { dates: string[]; date: string; today: string; count: number | null; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="page-header page-header-keep">
        <div className="page-header-icon">
          <HistoryIcon size={20} />
        </div>
        <div>
          <h1 className="page-title">필기 이력</h1>
          <p className="page-sub">칠판 필기를 시각별로 되돌아봅니다. 읽기 전용이며 최근 영업일 며칠 치만 보관됩니다(시스템 설정).</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {dates.length > 0 && <Segmented label="날짜" value={date} items={dateItems(dates, today)} />}
        {count !== null && <span className="text-sm text-slate-500">기록된 시각 {count}개</span>}
        <span className="flex-1" />
        <Link href="/dashboard" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <ArrowLeft size={15} /> 주문 목록
        </Link>
      </div>
      {children}
    </div>
  );
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  const style = tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-800' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700';
  const Icon = tone === 'danger' ? TriangleAlert : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${style}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <HistoryIcon size={22} />
      </div>
      <p className="text-base font-bold text-slate-800">{title}</p>
      {children}
    </div>
  );
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ date?: string; t?: string; g?: string }> }) {
  await requireMenu('dashboard');
  const { date, t, g } = await searchParams;
  const today = todayKST();
  const db = (await createClient()) as unknown as SupabaseClient;

  const index = await fetchHistoryIndex(db);
  if (!index.ok) {
    return (
      <Shell dates={[]} date={today} today={today} count={null}>
        <Note tone="danger">
          {index.needsMigration ? '필기 이력 테이블이 아직 없습니다. 마이그레이션 0067_board_ink_history.sql과 0068_board_ink_history_v2.sql을 먼저 적용해 주세요.' : `필기 이력을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요. (${index.message})`}
        </Note>
      </Shell>
    );
  }
  const { dates } = index.value;
  const selDate = date && dates.includes(date) ? date : dates[0] ?? today; // 날짜를 주지 않거나 이력이 없는 날이면 이력이 있는 가장 최근 날

  const day = await fetchDaySnapshots(db, selDate);
  if (!day.ok) {
    return (
      <Shell dates={dates} date={selDate} today={today} count={null}>
        <Note tone="danger">
          {day.needsMigration ? '필기 이력 열이 아직 없습니다. 마이그레이션 0068_board_ink_history_v2.sql을 먼저 적용해 주세요.' : `필기 이력을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요. (${day.message})`}
        </Note>
      </Shell>
    );
  }
  const infos = day.value;
  const points = buildTimePoints(infos);

  if (points.length === 0) {
    return (
      <Shell dates={dates} date={selDate} today={today} count={0}>
        <Empty title="필기 이력이 없습니다">
          <p className="text-sm text-slate-500">칠판에서 필기가 바뀌면 정기적으로 기록되고, 최근 영업일 며칠 치만 보관합니다.</p>
        </Empty>
      </Shell>
    );
  }

  const selIndex = Math.max(0, points.findIndex((p) => String(p.key) === t));
  const selPoint = points[selIndex];
  const groups = groupsAt(infos, selPoint.endMs); // 이 시각에 기록이 있던 묶음만
  const selGroup: BoardGroup = (g === 'bus' || g === 'sep') && groups.includes(g) ? g : selPoint.dropGroups[0] ?? selPoint.groups[0] ?? groups[0];
  const snaps = groupSnapshotsAt(infos, selGroup, selPoint.endMs);
  const loaded = await Promise.all(snaps.map((info) => fetchSnapshot(db, info.id)));
  const snapshots = loaded.flatMap((r, i) => (r.ok && r.value ? [{ info: snaps[i], data: r.value }] : []));
  // 표(주문 요약)는 요약이 있는 스냅샷 중 가장 나중에 찍힌 것, 필기는 묶음 안 모든 화면의 것을 합친다.
  const pool = snapshots.some((s) => s.data.cards) ? snapshots.filter((s) => s.data.cards) : snapshots;
  const primary = pool.reduce<(typeof pool)[number] | null>((best, s) => (best === null || Date.parse(s.info.capturedAt) > Date.parse(best.info.capturedAt) || (s.info.capturedAt === best.info.capturedAt && s.info.id > best.info.id) ? s : best), null);
  const cards = primary?.data.cards ? cardsOfGroup(primary.data.cards, selGroup) : null;
  const strokes = snapshots.flatMap((s) => s.data.strokes);
  const label = groupLabel(selGroup);

  const items: TimeItem[] = points.map((p) => ({
    key: p.key,
    time: kstTime(p.key),
    href: href(selDate, p.key, groupsAt(infos, p.endMs).includes(selGroup) ? selGroup : undefined),
    selected: p.key === selPoint.key,
    drop: p.dropGroups.length > 0,
  }));

  const drifting = snapshots.map((s) => ({ s, drift: driftMinutes(s.info.reason, s.info.summaryVersion, s.info.strokesSavedAt, s.info.capturedAt) })).find((x) => x.drift !== null);
  const hiddenOnPanel = strokes.filter((s) => s.anchor?.startsWith(SUM_PREFIX)).length;
  const capturedMinute = snapshots.length > 0 ? Math.floor(Math.max(...snapshots.map((s) => Date.parse(s.info.capturedAt))) / 60_000) * 60_000 : selPoint.key;
  const caption = `${selDate} · ${label} · ${kstTime(capturedMinute)} 기록`;
  const filename = `필기이력_${selDate}_${label.replaceAll(' ', '')}_${kstTime(capturedMinute).replace(':', '')}.png`;
  const boardReady = cards !== null && cards.length > 0;

  const tabs = <Segmented label="주문 구분" value={selGroup} items={groups.map((gr) => ({ key: gr, label: groupLabel(gr), href: href(selDate, selPoint.key, gr) }))} />;
  const notes = (
    <>
      {snapshots.some((s) => s.info.reason === 'drop') && (
        <Note tone="danger">
          <b>필기가 크게 줄어든 시점입니다.</b> 이 기록은 줄어들기 직전의 필기입니다.
        </Note>
      )}
      {drifting && (
        <Note tone="warn">
          필기 저장 {formatKst(drifting.s.info.strokesSavedAt)} · 주문 요약 {formatKst(drifting.s.info.capturedAt)}. 그 사이 주문이 바뀌었을 수 있어서 필기가 다른 줄 옆에 보일 수 있어요.
        </Note>
      )}
      {cards && snapshots.some((s) => s.info.summaryVersion < 2) && <Note tone="info">옛 형식의 기록입니다. 터미널·박스·물봉 표시는 없고, 필기는 줄·상품 칸에 맞춰 보여 줍니다.</Note>}
      {hiddenOnPanel > 0 && <Note tone="info">품목별 수량 패널에 쓴 필기 {hiddenOnPanel}획은 이 화면에 패널이 없어 보이지 않습니다.</Note>}
      {snapshots.length === 0 && <Note tone="danger">이 기록을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</Note>}
      {snapshots.length > 0 && snapshots.length < snaps.length && <Note tone="warn">일부 화면의 기록을 읽지 못해 그 화면의 필기는 보이지 않을 수 있습니다.</Note>}
      {snapshots.length > 0 && !cards && <Note tone="warn">이 기록은 주문 요약을 만들지 못해 표를 그릴 수 없습니다. 필기 {strokes.length.toLocaleString()}획만 남아 있습니다.</Note>}
      {cards && cards.length === 0 && <Note tone="info">이 시점에는 {label} 카드가 없었습니다.</Note>}
      {boardReady && strokes.length === 0 && <Note tone="info">이 시점에는 필기가 없었습니다.</Note>}
    </>
  );

  return (
    <Shell dates={dates} date={selDate} today={today} count={points.length}>
      <div className="grid gap-3 lg:grid-cols-[9rem_minmax(0,1fr)]">
        <aside className="min-w-0 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold">시각</span>
            <span className="hidden xl:inline">↑ ↓ 키</span>
          </div>
          <TimeList items={items} upHref={selIndex > 0 ? items[selIndex - 1].href : null} downHref={selIndex < items.length - 1 ? items[selIndex + 1].href : null} />
        </aside>

        <section className="min-w-0">
          {boardReady ? (
            <HistoryViewer cards={cards} meta={primary!.data.meta} strokes={strokes} snapshotKey={snapshots.map((s) => s.info.id).join('-')} caption={caption} filename={filename} toolbar={tabs}>
              {notes}
            </HistoryViewer>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">{tabs}</div>
              {notes}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
