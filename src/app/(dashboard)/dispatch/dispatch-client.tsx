'use client';
import '@/components/admin/admin.css';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DateNav } from '@/components/date-nav';
import { MigrationNotice } from '@/components/migration-notice';
import { Segmented } from '@/components/segmented';
import type { MessageRow } from '@/lib/customer-message';
import { groupSettledCustomers } from '@/lib/customer-message';
import type { SentEntry } from '@/lib/dispatch-log';
import type { ScanShareTemplate } from '@/lib/scan-share-template';
import type { ReceiptRecord } from '@/lib/settlement/receipt-server';
import type { ScanCard } from '../scan/scan-client';
import { CustomerSection } from './customer-section';
import { DriverSection } from './driver-section';

type Tab = 'driver' | 'customer';

// 보내기 화면: 날짜 하나로 구역(퀵기사·고객사)을 오간다. 보이는 구역은 권한(canDriver·canCustomers)이 정한다.
export function DispatchClient({
  orderDate,
  today,
  canDriver,
  canCustomers,
  canReceipts,
  cards,
  shareTemplate,
  salesRows,
  salesMissing,
  receipts,
  sellers,
  receiptsMissing,
  sentDriver,
  sentMessage,
  sentReceipt,
  logEnabled,
}: {
  orderDate: string;
  today: string;
  canDriver: boolean;
  canCustomers: boolean;
  canReceipts: boolean;
  cards: ScanCard[];
  shareTemplate: ScanShareTemplate;
  salesRows: MessageRow[]; // 그날 정산 판매내역 줄(정산 보기 권한이 없으면 빈 배열)
  salesMissing: string[] | null; // 정산 판매내역 마이그레이션이 없을 때 필요한 파일(없으면 null)
  receipts: ReceiptRecord[];
  sellers: { id: string; name: string }[];
  receiptsMissing: string[] | null; // 영수증 테이블 마이그레이션이 없을 때 필요한 파일(없으면 null)
  sentDriver: Record<string, SentEntry>; // 터미널 이름 → 가장 최근 보냄 기록
  sentMessage: Record<string, SentEntry>; // 고객명 → 가장 최근 메시지 보냄 기록
  sentReceipt: Record<string, SentEntry>; // 영수증 카드 키 → 가장 최근 보냄 기록
  logEnabled: boolean; // 보내기 기록 마이그레이션(0052) 적용 여부
}) {
  const router = useRouter();
  const settledCount = groupSettledCustomers(salesRows).settled.length;
  const items = [
    ...(canDriver ? [{ key: 'driver' as const, label: '퀵기사' }] : []),
    ...(canCustomers ? [{ key: 'customer' as const, label: `고객사${settledCount > 0 ? ` ${settledCount}` : ''}` }] : []),
  ];
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab | null = tab && items.some((i) => i.key === tab) ? tab : items[0]?.key ?? null;

  if (!active) return <p className="ak-muted">보낼 수 있는 항목이 없습니다. 퀵기사는 상차 스캔 보기, 고객사는 정산 보기 권한이 필요합니다.</p>;

  return (
    <div className="dp-root">
      <div className="dp-bar">
        <DateNav value={orderDate} today={today} onChange={(date) => router.push(`/dispatch?d=${date}`)} grow />
        {items.length > 1 && <Segmented items={items} value={active} onSelect={setTab} label="보낼 대상" fill />}
      </div>

      {active === 'driver' && <DriverSection orderDate={orderDate} cards={cards} shareTemplate={shareTemplate} sent={sentDriver} logEnabled={logEnabled} />}
      {active === 'customer' &&
        (salesMissing ? (
          <MigrationNotice feature="정산 판매내역" migrations={salesMissing} />
        ) : (
          <CustomerSection
            key={orderDate}
            orderDate={orderDate}
            rows={salesRows}
            receipts={receipts}
            sellers={sellers}
            canReceipts={canReceipts}
            receiptsMissing={receiptsMissing}
            sentMessage={sentMessage}
            sentReceipt={sentReceipt}
            logEnabled={logEnabled}
          />
        ))}

      <style>{`
        .dp-root { display: flex; flex-direction: column; gap: var(--space-block); min-width: 0; }
        .dp-bar { display: flex; flex-direction: column; gap: 0.5rem; }
        @media (min-width: 769px) { .dp-bar { flex-direction: row; align-items: center; } .dp-bar .sg-root { width: auto; } }
      `}</style>
    </div>
  );
}
