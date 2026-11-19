import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchHistoryIndex, fetchSnapshot, fetchSnapshotList, type SnapshotInfo } from '@/lib/ink/history-queries';
import { driftMinutes, dropPercent, formatKst, monitorLabel } from '@/lib/ink/history-view';
import { requireMenu } from '@/lib/permissions/access';
import { createClient } from '@/lib/supabase/server';
import { HistoryBoard } from './history-board';

// 칠판 필기 이력 보기(읽기 전용). 주문 목록·필기와 따로 동작하고 이 화면은 어떤 것도 쓰지 않는다. 주소로만 들어온다(메뉴 링크 없음).
// 이력은 정기 스냅샷(시계 기준)과 점 수 급감 스냅샷으로 남고 7일 보관된다: docs/decisions/2026-11-18-board-ink-history-v2.md

const href = (date: string, monitor: string, snap?: number) => `/dashboard/history?date=${date}&monitor=${monitor}${snap !== undefined ? `&snap=${snap}` : ''}`;
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm font-semibold ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`;
const SUM_PREFIX = 'sum:';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">필기 이력</h1>
        <p className="mt-1 text-sm text-slate-500">칠판 필기를 일정 간격과 필기가 크게 줄었을 때 남긴 기록입니다. 읽기 전용이고 7일간 보관됩니다.</p>
      </div>
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  const style = tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-800' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700';
  return <div className={`rounded-lg border px-3 py-2 text-sm ${style}`}>{children}</div>;
}

function SnapshotItem({ info, date, monitor, selected }: { info: SnapshotInfo; date: string; monitor: string; selected: boolean }) {
  const drop = info.reason === 'drop';
  const percent = dropPercent(info.prevPointCount, info.newPointCount);
  return (
    <Link href={href(date, monitor, info.id)} className={`block rounded-lg border px-3 py-2 text-sm ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-slate-900">{formatKst(info.capturedAt)}</span>
        {drop ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-bold text-rose-700">급감 감지</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">정기</span>}
        {info.summaryVersion < 2 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">옛 형식</span>}
      </div>
      {drop && info.prevPointCount !== null && info.newPointCount !== null && (
        <div className="mt-1 text-xs font-semibold text-rose-700">
          점 {info.prevPointCount.toLocaleString()} → {info.newPointCount.toLocaleString()}
          {percent !== null && ` (${percent}% 감소)`}
        </div>
      )}
      <div className="mt-0.5 text-xs text-slate-500">
        획 {info.strokeCount.toLocaleString()}개 · 점 {info.pointCount.toLocaleString()}개
      </div>
    </Link>
  );
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ date?: string; monitor?: string; snap?: string }> }) {
  await requireMenu('dashboard');
  const { date, monitor, snap } = await searchParams;
  const db = (await createClient()) as unknown as SupabaseClient;

  const index = await fetchHistoryIndex(db);
  if (!index.ok) {
    return (
      <Shell>
        <Notice tone="danger">
          {index.needsMigration ? '필기 이력 테이블이 아직 없습니다. 마이그레이션 0067_board_ink_history.sql과 0068_board_ink_history_v2.sql을 먼저 적용해 주세요.' : `필기 이력을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요. (${index.message})`}
        </Notice>
      </Shell>
    );
  }
  const { dates, monitorsByDate } = index.value;
  if (dates.length === 0) {
    return (
      <Shell>
        <Notice tone="info">남은 필기 이력이 없습니다. 칠판에서 필기가 바뀌면 정기적으로 쌓입니다.</Notice>
      </Shell>
    );
  }

  const selDate = date && dates.includes(date) ? date : dates[0];
  const monitors = monitorsByDate[selDate] ?? [];
  const selMonitor = monitor && monitors.includes(monitor) ? monitor : monitors[0];

  const list = await fetchSnapshotList(db, selDate, selMonitor);
  if (!list.ok) {
    return (
      <Shell>
        <Notice tone="danger">
          {list.needsMigration ? '필기 이력 열이 아직 없습니다. 마이그레이션 0068_board_ink_history_v2.sql을 먼저 적용해 주세요.' : `필기 이력 목록을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요. (${list.message})`}
        </Notice>
      </Shell>
    );
  }
  const infos = list.value;
  const current = infos.find((i) => i.id === Number(snap)) ?? infos[0];
  const loaded = current ? await fetchSnapshot(db, current.id) : null;
  const snapshot = loaded && loaded.ok ? loaded.value : null;

  const drift = current ? driftMinutes(current.reason, current.summaryVersion, current.strokesSavedAt, current.capturedAt) : null;
  const hiddenOnPanel = snapshot ? snapshot.strokes.filter((s) => s.anchor?.startsWith(SUM_PREFIX)).length : 0;

  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-500">날짜</span>
        {dates.map((d) => (
          <Link key={d} href={href(d, (monitorsByDate[d] ?? [])[0] ?? '1')} className={chip(d === selDate)}>
            {d.slice(5)}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-500">화면</span>
        {monitors.map((m) => (
          <Link key={m} href={href(selDate, m)} className={chip(m === selMonitor)}>
            {monitorLabel(m)}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
          {infos.length === 0 && <Notice tone="info">이 화면의 이력이 없습니다.</Notice>}
          {infos.map((info) => (
            <SnapshotItem key={info.id} info={info} date={selDate} monitor={selMonitor} selected={info.id === current?.id} />
          ))}
        </aside>

        <section className="min-w-0 space-y-3">
          {current && (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-lg font-bold text-slate-900">{formatKst(current.capturedAt)} 스냅샷</h2>
                <span className="text-sm text-slate-500">
                  {selDate.slice(5)} {monitorLabel(selMonitor)}
                </span>
              </div>
              {current.reason === 'drop' && current.prevPointCount !== null && current.newPointCount !== null && (
                <Notice tone="danger">
                  점 수 급감 감지: 직전 {current.prevPointCount.toLocaleString()}점 → {current.newPointCount.toLocaleString()}점
                  {dropPercent(current.prevPointCount, current.newPointCount) !== null && ` (${dropPercent(current.prevPointCount, current.newPointCount)}% 감소)`}. 이 스냅샷은 줄어들기 직전의 필기입니다.
                </Notice>
              )}
              {drift !== null && (
                <Notice tone="warn">
                  필기 저장 {formatKst(current.strokesSavedAt)} · 주문 요약 {formatKst(current.capturedAt)}. 그 사이 주문이 바뀌었을 수 있어서 필기가 다른 줄 옆에 보일 수 있어요.
                </Notice>
              )}
              {current.summaryVersion < 2 && snapshot?.cards && <Notice tone="info">옛 형식 스냅샷입니다. 터미널·박스·물봉 표시는 없고, 필기는 줄·상품 칸에 맞춰 보여 줍니다.</Notice>}
              {hiddenOnPanel > 0 && <Notice tone="info">품목별 수량 패널에 쓴 필기 {hiddenOnPanel}획은 이 화면에 패널이 없어 보이지 않습니다.</Notice>}
              {!snapshot && <Notice tone="danger">이 스냅샷을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</Notice>}
              {snapshot && !snapshot.cards && <Notice tone="warn">이 스냅샷은 주문 요약을 만들지 못해 표를 그릴 수 없습니다. 필기 {snapshot.strokes.length.toLocaleString()}획만 남아 있습니다.</Notice>}
              {snapshot?.cards && snapshot.cards.length === 0 && <Notice tone="info">이 날짜에는 주문 카드가 없었습니다.</Notice>}
              {snapshot?.cards && snapshot.cards.length > 0 && <HistoryBoard cards={snapshot.cards} meta={snapshot.meta} strokes={snapshot.strokes} snapshotKey={String(current.id)} />}
              {snapshot?.cards && snapshot.cards.length > 0 && <p className="text-xs text-slate-500">표는 칠판과 같은 열 순서로 다시 그린 읽기 전용 화면이라 글자 크기와 열 폭이 조금 다를 수 있습니다. 줄·칸 밖에 쓴 낙서는 위치가 정확하지 않을 수 있습니다.</p>}
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}
