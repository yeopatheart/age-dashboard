import { Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { can, requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { AdminHeader } from '@/components/admin/admin-kit';
import { todayKST } from '@/lib/order-date';
import { MigrationNotice } from '@/components/migration-notice';
import { latestByKey, type DispatchLogRow } from '@/lib/dispatch-log';
import { loadDispatchLog } from '@/lib/dispatch-log-server';
import { loadScanCards } from '@/lib/scan-cards';
import { loadAppSettings } from '@/lib/settings-server';
import { DEFAULT_SCAN_SHARE_TEMPLATE } from '@/lib/scan-share-template';
import { loadReceipts, type ReceiptRecord } from '@/lib/settlement/receipt-server';
import type { ScanCard } from '../scan/scan-client';
import { DispatchClient } from './dispatch-client';

// 보내기: 출고가 끝난 뒤 카카오톡으로 보내는 일을 한 화면에 모은다(모바일 우선). 구역마다 기존 화면의 로직을 그대로 쓴다.
//  - 기사: 터미널별로 퀵 기사님께 보낼 상차 완료 글(상차 스캔과 같은 글·같은 설정). 보이는 조건: 상차 스캔 보기 권한.
//  - 영수증: 그날 발행한 영수증 카드와 이미지 보내기(영수증 화면과 같음). 보이는 조건: 영수증 보기 권한.
// 날짜는 ?d=YYYY-MM-DD(기본 오늘). 영수증은 출고일이 그날인 것을 보여 준다.
export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const access = await requireMenu('dispatch');
  const { d } = await searchParams;
  const today = todayKST();
  const orderDate = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
  const canDriver = can(access, 'scan:view');
  const canReceipts = can(access, 'receipts:view');
  const supabase = await createClient();

  const [cards, settings, receipts, sellers, log] = await Promise.all([
    canDriver ? loadScanCards(supabase, orderDate) : Promise.resolve<ScanCard[]>([]),
    canDriver ? loadAppSettings(supabase) : Promise.resolve(null),
    canReceipts ? rowsOrMissing(loadReceipts(supabase, orderDate, orderDate)) : Promise.resolve<{ rows: ReceiptRecord[]; missing: string | null }>({ rows: [], missing: null }),
    canReceipts ? rowsOrMissing(fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: ')) : Promise.resolve<{ rows: { id: string; name: string }[]; missing: string | null }>({ rows: [], missing: null }),
    rowsOrMissing(loadDispatchLog(supabase, orderDate)),
  ]);
  const receiptsMissing = migrationsFor([receipts.missing, sellers.missing].filter((x): x is string => !!x));
  const receiptsUnavailable = !!receipts.missing || !!sellers.missing;
  // 보내기 기록 테이블(0052)이 없어도 화면은 열린다: 기록 없이 보내기만 되고 위에 안내를 보여 준다.
  const logRows: DispatchLogRow[] = log.rows;
  const logMissing = log.missing ? migrationsFor([log.missing]) : null;

  return (
    <div className="ak-page">
      <AdminHeader icon={<Send size={20} />} title="보내기" sub="출고가 끝난 뒤 카카오톡으로 보내는 글과 영수증을 한곳에서 보냅니다. 업체·터미널마다 보내기를 눌러 방을 고르세요." />
      {logMissing && <MigrationNotice feature="보내기 기록(보냄 표시)" migrations={logMissing} />}
      <DispatchClient
        key={orderDate}
        orderDate={orderDate}
        today={today}
        canDriver={canDriver}
        canReceipts={canReceipts}
        cards={cards}
        shareTemplate={settings?.scanShare ?? DEFAULT_SCAN_SHARE_TEMPLATE}
        receipts={receiptsUnavailable ? [] : receipts.rows}
        sellers={receiptsUnavailable ? [] : sellers.rows}
        receiptsMissing={receiptsUnavailable ? receiptsMissing : null}
        sentDriver={latestByKey(logRows, 'driver')}
        sentReceipt={latestByKey(logRows, 'receipt')}
        logEnabled={!logMissing}
      />
    </div>
  );
}
