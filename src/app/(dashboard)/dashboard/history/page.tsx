import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertTriangle, ArrowLeft, History as HistoryIcon, Info, TriangleAlert } from 'lucide-react';
import { Segmented } from '@/components/segmented';
import { fetchDaySnapshots, fetchHistoryIndex, fetchSnapshot } from '@/lib/ink/history-queries';
import { buildTimePoints, monitorsAt, snapshotAt } from '@/lib/ink/history-timeline';
import { driftMinutes, dropPercent, formatKst, kstTime, monitorLabel, monitorShortLabel } from '@/lib/ink/history-view';
import { todayKST } from '@/lib/order-date';
import { requireMenu } from '@/lib/permissions/access';
import { createClient } from '@/lib/supabase/server';
import { HistoryDateNav, TimeList, type TimeItem } from './history-nav';
import { HistoryViewer } from './history-viewer';

// 칠판 필기 이력 보기(읽기 전용). 주문 목록·필기와 따로 동작하고 이 화면은 어떤 것도 쓰지 않는다.
// 흐름: 날짜 → 왼쪽 시각 목록(정기 스냅샷과 급감 스냅샷을 분 단위로 묶음) → 오른쪽에서 그 시각에 존재한 화면(모니터 1·2, 별도 주문)을 골라 본다.
// 이력은 최근 N영업일(설정, 기본 2) 보관: docs/decisions/2026-11-18-board-ink-history-v2.md, 화면 결정: docs/decisions/2026-11-19-board-ink-history-viewer.md

const href = (date: string, t?: number, monitor?: string) => `/dashboard/history?date=${date}${t !== undefined ? `&t=${t}` : ''}${monitor ? `&m=${monitor}` : ''}`;
const SUM_PREFIX = 'sum:';

function Shell({ date, today, count, children }: { date: string; today: string; count: number | null; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
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
        <HistoryDateNav value={date} today={today} />
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

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ date?: string; t?: string; m?: string }> }) {
  await requireMenu('dashboard');
  const { date, t, m } = await searchParams;
  const today = todayKST();
  const db = (await createClient()) as unknown as SupabaseClient;

  const index = await fetchHistoryIndex(db);
  const askedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  if (!index.ok) {
    return (
      <Shell date={askedDate ?? today} today={today} count={null}>
        <Note tone="danger">
          {index.needsMigration ? '필기 이력 테이블이 아직 없습니다. 마이그레이션 0067_board_ink_history.sql과 0068_board_ink_history_v2.sql을 먼저 적용해 주세요.' : `필기 이력을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요. (${index.message})`}
        </Note>
      </Shell>
    );
  }
  const { dates } = index.value;
  const selDate = askedDate ?? dates[0] ?? today; // 날짜를 주지 않으면 이력이 있는 가장 최근 날

  const day = await fetchDaySnapshots(db, selDate);
  if (!day.ok) {
    return (
      <Shell date={selDate} today={today} count={null}>
        <Note tone="danger">
          {day.needsMigration ? '필기 이력 열이 아직 없습니다. 마이그레이션 0068_board_ink_history_v2.sql을 먼저 적용해 주세요.' : `필기 이력을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요. (${day.message})`}
        </Note>
      </Shell>
    );
  }
  const infos = day.value;
  const points = buildTimePoints(infos);

  if (points.length === 0) {
    const others = dates.filter((d) => d !== selDate).slice(0, 7);
    return (
      <Shell date={selDate} today={today} count={0}>
        <Empty title={`${selDate.replaceAll('-', '.')}에는 필기 이력이 없습니다`}>
          <p className="text-sm text-slate-500">칠판에서 필기가 바뀌면 정기적으로 기록되고, 최근 영업일 며칠 치만 보관합니다.</p>
          {others.length > 0 && (
            <div className="mt-1 flex flex-col items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">이력이 있는 날</span>
              <Segmented label="이력이 있는 날" value="" items={others.map((d) => ({ key: d, label: d.slice(5).replace('-', '.'), href: href(d) }))} />
            </div>
          )}
        </Empty>
      </Shell>
    );
  }

  const selIndex = Math.max(0, points.findIndex((p) => String(p.key) === t));
  const selPoint = points[selIndex];
  const monitors = monitorsAt(infos, selPoint.endMs); // 이 시각에 기록이 있던 화면만
  const selMonitor = m && monitors.includes(m) ? m : selPoint.drops[0]?.monitor ?? selPoint.monitors[0] ?? monitors[0];
  const current = snapshotAt(infos, selMonitor, selPoint.endMs);
  const loaded = current ? await fetchSnapshot(db, current.id) : null;
  const snapshot = loaded && loaded.ok ? loaded.value : null;

  const items: TimeItem[] = points.map((p) => ({
    key: p.key,
    time: kstTime(p.key),
    href: href(selDate, p.key, monitorsAt(infos, p.endMs).includes(selMonitor) ? selMonitor : undefined),
    selected: p.key === selPoint.key,
    screens: p.monitors.map(monitorShortLabel).join(' · '),
    drops: p.drops.map((d) => {
      const percent = dropPercent(d.prev, d.next);
      return { text: `${monitorShortLabel(d.monitor)}: 점 ${d.prev?.toLocaleString() ?? '?'} → ${d.next?.toLocaleString() ?? '?'}${percent !== null ? ` (${percent}%↓)` : ''}` };
    }),
  }));

  const drift = current ? driftMinutes(current.reason, current.summaryVersion, current.strokesSavedAt, current.capturedAt) : null;
  const hiddenOnPanel = snapshot ? snapshot.strokes.filter((s) => s.anchor?.startsWith(SUM_PREFIX)).length : 0;
  const capturedMinute = current ? Math.floor(Date.parse(current.capturedAt) / 60_000) * 60_000 : selPoint.key;
  const stale = current !== null && capturedMinute !== selPoint.key;
  const dropPercentNow = current?.reason === 'drop' ? dropPercent(current.prevPointCount, current.newPointCount) : null;
  const caption = current ? `${selDate} · ${monitorLabel(selMonitor)} · ${kstTime(capturedMinute)} 기록` : '';
  const filename = current ? `필기이력_${selDate}_${monitorLabel(selMonitor).replaceAll(' ', '')}_${kstTime(capturedMinute).replace(':', '')}.png` : 'board.png';

  return (
    <Shell date={selDate} today={today} count={points.length}>
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="min-w-0 lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto lg:pr-1">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold">시각</span>
            <span className="hidden lg:inline">↑ ↓ 키로 이동</span>
          </div>
          <TimeList items={items} upHref={selIndex > 0 ? items[selIndex - 1].href : null} downHref={selIndex < items.length - 1 ? items[selIndex + 1].href : null} />
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Segmented label="화면" value={selMonitor} items={monitors.map((mon) => ({ key: mon, label: monitorLabel(mon), href: href(selDate, selPoint.key, mon) }))} />
            <span className="text-sm text-slate-500">
              <b className="font-bold text-slate-800">{kstTime(selPoint.key)}</b> 시점
              {current && <> · 획 {current.strokeCount.toLocaleString()}개 · 점 {current.pointCount.toLocaleString()}개</>}
            </span>
          </div>

          {stale && current && <Note tone="info">이 시각에는 {monitorLabel(selMonitor)}의 새 기록이 없어 직전 기록({kstTime(capturedMinute)})을 보여 줍니다.</Note>}
          {current?.reason === 'drop' && current.prevPointCount !== null && current.newPointCount !== null && (
            <Note tone="danger">
              <b>점 수 급감 감지</b>: 직전 {current.prevPointCount.toLocaleString()}점 → {current.newPointCount.toLocaleString()}점{dropPercentNow !== null && ` (${dropPercentNow}% 감소)`}. 이 기록은 줄어들기 직전의 필기입니다.
            </Note>
          )}
          {current && drift !== null && (
            <Note tone="warn">
              필기 저장 {formatKst(current.strokesSavedAt)} · 주문 요약 {formatKst(current.capturedAt)}. 그 사이 주문이 바뀌었을 수 있어서 필기가 다른 줄 옆에 보일 수 있어요.
            </Note>
          )}
          {current && current.summaryVersion < 2 && snapshot?.cards && <Note tone="info">옛 형식의 기록입니다. 터미널·박스·물봉 표시는 없고, 필기는 줄·상품 칸에 맞춰 보여 줍니다.</Note>}
          {hiddenOnPanel > 0 && <Note tone="info">품목별 수량 패널에 쓴 필기 {hiddenOnPanel}획은 이 화면에 패널이 없어 보이지 않습니다.</Note>}
          {!snapshot && <Note tone="danger">이 기록을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</Note>}
          {snapshot && !snapshot.cards && <Note tone="warn">이 기록은 주문 요약을 만들지 못해 표를 그릴 수 없습니다. 필기 {snapshot.strokes.length.toLocaleString()}획만 남아 있습니다.</Note>}
          {snapshot?.cards && snapshot.cards.length === 0 && <Note tone="info">이 날짜에는 주문 카드가 없었습니다.</Note>}
          {snapshot?.cards && snapshot.cards.length > 0 && snapshot.strokes.length === 0 && <Note tone="info">이 시점에는 필기가 없었습니다.</Note>}

          {snapshot?.cards && snapshot.cards.length > 0 && current && (
            <>
              <HistoryViewer cards={snapshot.cards} meta={snapshot.meta} strokes={snapshot.strokes} snapshotKey={String(current.id)} caption={caption} filename={filename} />
              <p className="text-xs text-slate-500">표는 칠판과 같은 열 순서로 다시 그린 읽기 전용 화면이라 글자 크기와 열 폭이 조금 다를 수 있습니다. 줄·칸 밖에 쓴 낙서는 위치가 정확하지 않을 수 있습니다.</p>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}
