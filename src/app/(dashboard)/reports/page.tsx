import { createClient } from '@/lib/supabase/server';
import { getPeriod, type Granularity, type ReportSummary } from '@/lib/report';
import { ReportsClient } from './reports-client';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ g?: string; date?: string }> }) {
  const { g, date } = await searchParams;
  const today = todayKST();
  const granularity = GRANULARITIES.find((x) => x === g) ?? 'month';
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const period = getPeriod(granularity, anchor);

  const supabase = await createClient();
  // 집계는 DB 함수(report_summary, 0017)에서 끝내고 결과만 받는다.
  const { data, error } = await supabase.rpc('report_summary', { p_from: period.from, p_to: period.to });
  if (error) throw new Error(`리포트 조회 실패: ${error.message}`);

  return (
    <ReportsClient
      summary={data as ReportSummary}
      granularity={granularity}
      anchor={anchor}
      today={today}
      period={period}
    />
  );
}
