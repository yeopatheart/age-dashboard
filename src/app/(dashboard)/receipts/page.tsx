import { FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MigrationNotice } from '@/components/migration-notice';
import { todayKST } from '@/lib/order-date';
import { parsePeriodParams } from '@/lib/settlement/url';
import { latestByKey } from '@/lib/dispatch-log';
import { loadDispatchLog } from '@/lib/dispatch-log-server';
import { loadReceipts } from '@/lib/settlement/receipt-server';
import { PeriodBar } from '../settlement/period-bar';
import { ReceiptsClient } from './receipts-client';

// 영수증: 정산 판매내역에서 발행한 영수증의 목록·보기·공유·삭제. 영수증 만들기는 정산 화면(판매내역에서 줄을 골라 만든다)에서 한다.
// 하루 단위로만 본다: ?d=YYYY-MM-DD(기준일, 기본 오늘). 출고일이 그날인 영수증을 보여 준다.
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const accessCheck = requireMenu('receipts');
  const { d } = await searchParams;
  const today = todayKST();
  const { granularity, anchor, period } = parsePeriodParams('day', d, today);
  const supabase = await createClient();

  const header = <AdminHeader icon={<FileText size={20} />} title="영수증" sub="그날 발행한 영수증을 고객별로 모아 보고 카카오톡 등으로 보냅니다. 영수증을 만들려면 정산 화면에서 판매내역 줄을 골라 “영수증 만들기”를 누르세요." />;

  const [, receipts, sellers, log] = await Promise.all([
    accessCheck,
    rowsOrMissing(loadReceipts(supabase, period.from, period.to)),
    rowsOrMissing(fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: ')),
    rowsOrMissing(loadDispatchLog(supabase, period.from)), // 영수증은 하루 단위로만 본다(period.from = 기준일)
  ]);

  const missing = [receipts.missing, sellers.missing].filter((x): x is string => !!x);
  if (missing.length > 0) {
    return (
      <div className="ak-page">
        {header}
        <MigrationNotice feature="영수증" migrations={migrationsFor(missing)} />
      </div>
    );
  }

  const logMissing = log.missing ? migrationsFor([log.missing]) : null;

  return (
    <div className="ak-page">
      {header}
      {logMissing && <MigrationNotice feature="보내기 기록(보냄 표시)" migrations={logMissing} />}
      <PeriodBar granularity={granularity} anchor={anchor} today={today} periodLabel={period.label} basePath="/receipts" dayOnly />
      {/* 기간을 옮기면 열어 둔 영수증·검색을 새로 시작한다(key) */}
      <ReceiptsClient key={`${granularity}-${anchor}`} receipts={receipts.rows} sellers={sellers.rows} sent={latestByKey(log.rows, 'receipt')} logEnabled={!logMissing} />
    </div>
  );
}
