import type { ReactNode } from 'react';
import { ReportTabs } from './report-tabs';

// 리포트 공통 틀: 위에 리포트 종류 탭을 두고 아래에 각 리포트를 보여 준다. 탭은 리포트가 늘 때마다 report-tabs.tsx에 한 줄씩 더한다.
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-block)' }}>
      <ReportTabs />
      {children}
    </div>
  );
}
