'use client';
// 메뉴 이동이 끝난 시점(새 화면 경로가 반영된 시점)을 성능 계측에 알린다. 화면에는 아무것도 그리지 않는다(src/lib/perf-client.ts).
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { onPathnameCommitted } from '@/lib/perf-client';

export function PerfProbe() {
  const pathname = usePathname();
  useEffect(() => {
    onPathnameCommitted(pathname);
  }, [pathname]);
  return null;
}
