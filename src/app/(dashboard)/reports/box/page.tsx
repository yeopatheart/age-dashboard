import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { getPeriod, type Granularity } from '@/lib/report';
import { todayKST } from '@/lib/order-date';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { bucketsOf } from '@/lib/reports/buckets';
import { summarizeBoxUsage } from '@/lib/reports/box-usage';
import { submissionHistory, summarizeAccuracy } from '@/lib/reports/packing-accuracy';
import { loadBoxOrder, loadBoxReportData, loadSubmitEvents } from '@/lib/reports/box-report-server';
import { BoxReportClient } from './box-report-client';

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];

// 박스 리포트: 사용량(박스 종류별 추이·소진 속도)과 추천 정확도(추이·틀린 유형·어떤 경우에 떨어지는지)를 한 화면에서 본다.
// 기간은 ?g=day|week|month|year(기본 월), ?date=기준일. 보기는 ?view=usage|accuracy. 보는 보기에 필요한 조회만 한다.
export default async function BoxReportPage({ searchParams }: { searchParams: Promise<{ g?: string; date?: string; view?: string }> }) {
  const accessCheck = requireMenu('reports');
  const { g, date, view } = await searchParams;
  const today = todayKST();
  const granularity = GRANULARITIES.find((x) => x === g) ?? 'month';
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const period = getPeriod(granularity, anchor);
  const buckets = bucketsOf(granularity, period);
  const tab = view === 'accuracy' ? 'accuracy' : 'usage';

  const supabase = await createClient();
  const [, data, boxOrder, events] = await Promise.all([
    accessCheck,
    loadBoxReportData(supabase, period.from, period.to, tab === 'accuracy'),
    loadBoxOrder(supabase),
    tab === 'accuracy' ? rowsOrMissing(loadSubmitEvents(supabase, period.from, period.to)) : Promise.resolve({ rows: [], missing: null }),
  ]);

  return (
    <BoxReportClient
      view={tab}
      granularity={granularity}
      anchor={anchor}
      today={today}
      period={period}
      boxOrder={boxOrder}
      recordCount={data.recordCount}
      withoutRecommendation={data.withoutRecommendation}
      usage={tab === 'usage' ? summarizeBoxUsage(data.usageRows, buckets, granularity) : null}
      accuracy={tab === 'accuracy' ? summarizeAccuracy(data.accuracyRecords, buckets, granularity) : null}
      history={tab === 'accuracy' && !events.missing ? submissionHistory(events.rows) : null}
      historyMissing={events.missing ? migrationsFor([events.missing]) : null}
    />
  );
}
