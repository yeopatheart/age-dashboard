import { redirect } from 'next/navigation';
import { firstAllowedHref, getAccess } from '@/lib/permissions/access';
import { NoAccessActions } from './no-access-actions';

// 열 수 있는 메뉴가 하나도 없는 계정이 도착하는 화면. 메뉴가 생기면 바로 그쪽으로 보낸다.
export default async function NoAccessPage() {
  const href = firstAllowedHref(await getAccess());
  if (href) redirect(href);
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 800 }}>열 수 있는 메뉴가 없습니다</h1>
      <p style={{ color: '#64748b', wordBreak: 'keep-all' }}>관리자에게 메뉴 권한을 요청하세요.</p>
      <NoAccessActions />
    </main>
  );
}
