'use client';
import { usePathname } from 'next/navigation';
import '@/components/admin/admin.css';
import { useCan } from '@/components/permissions-context';
import { Segmented } from '@/components/segmented';

// 리포트 종류. href가 곧 주소다(docs/decisions/2026-11-10-reports-roadmap.md). 예전의 "주문 수량" 탭은 판매·수익 리포트로 대체해 없앴다.
const TABS = [
  { key: '/reports/box', label: '박스', href: '/reports/box' },
  { key: '/reports/time', label: '운영 시간', href: '/reports/time' },
  { key: '/reports/ops', label: '운영 개선', href: '/reports/ops' },
  { key: '/reports/sales', label: '판매·수익', href: '/reports/sales', needs: 'settlement:view' as const }, // 금액이 나오므로 정산 보기 권한이 있어야 한다
];

export function ReportTabs() {
  const pathname = usePathname();
  const can = useCan();
  const tabs = TABS.filter((t) => !t.needs || can(t.needs));
  const active = tabs.find((t) => pathname.startsWith(t.key))?.key ?? tabs[0].key;
  return <Segmented label="리포트 종류" value={active} items={tabs} fill />;
}
