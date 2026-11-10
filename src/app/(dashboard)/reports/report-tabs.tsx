'use client';
import { usePathname } from 'next/navigation';
import '@/components/admin/admin.css';
import { Segmented } from '@/components/segmented';

// 리포트 종류. href가 곧 주소다. 주문 수량은 판매·수익 리포트가 생기면 그쪽으로 합친다(docs/decisions/2026-11-10-reports-roadmap.md).
const TABS = [
  { key: '/reports', label: '주문 수량', href: '/reports' },
  { key: '/reports/box', label: '박스', href: '/reports/box' },
  { key: '/reports/time', label: '운영 시간', href: '/reports/time' },
];

export function ReportTabs() {
  const pathname = usePathname();
  const active = TABS.find((t) => t.key !== '/reports' && pathname.startsWith(t.key))?.key ?? '/reports';
  return <Segmented label="리포트 종류" value={active} items={TABS} fill />;
}
