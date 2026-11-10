import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { getPeriod, type Granularity } from '@/lib/report';
import { todayKST } from '@/lib/order-date';
import { bottleneck, countOutOfRange, leadTimeStats, slowestCards, summarizeDays, terminalLoadStats } from '@/lib/reports/ops-time';
import { loadOpsCards } from '@/lib/reports/ops-time-server';
import { TimeReportClient } from './time-report-client';

// 이 탭은 년 단위를 두지 않는다(이벤트 데이터가 많고 일·주·월로 충분하다).
const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

// 운영 시간 리포트: 박스 할당·라벨 출력·포장·상차의 하루 작업 구간, 마감 시각 추이, 카드 단위 리드타임, 터미널별 상차 완료 시각.
// 작업 시작 시각이 저장되지 않아 "작업 자체의 소요 시간"이 아니라 단계마다 남는 시각으로 잰다(정의·한계: docs/decisions/2026-11-10-reports-time.md).
export default async function TimeReportPage({ searchParams }: { searchParams: Promise<{ g?: string; date?: string }> }) {
  const accessCheck = requireMenu('reports');
  const { g, date } = await searchParams;
  const today = todayKST();
  const granularity = GRANULARITIES.find((x) => x === g) ?? 'week';
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const period = getPeriod(granularity, anchor);

  const supabase = await createClient();
  const [, load] = await Promise.all([accessCheck, loadOpsCards(supabase, period.from, period.to)]);
  const leadTimes = leadTimeStats(load.cards);

  return (
    <TimeReportClient
      granularity={granularity}
      anchor={anchor}
      today={today}
      period={period}
      cardCount={load.cards.length}
      parcelCount={load.cards.filter((c) => c.parcel).length}
      submitFromHistory={load.submitFromHistory}
      outOfRangeCards={countOutOfRange(load.cards)}
      days={summarizeDays(load.cards)}
      leadTimes={leadTimes}
      bottleneckKey={bottleneck(leadTimes)?.key ?? null}
      slowest={slowestCards(load.cards, 10)}
      terminals={terminalLoadStats(load.cards)}
    />
  );
}
