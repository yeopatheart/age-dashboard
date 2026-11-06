import Link from 'next/link';

export default function DashboardNotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '3rem 1rem', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.125rem', fontWeight: 800 }}>페이지를 찾을 수 없습니다</h2>
      <Link href="/" style={{ padding: '0.5rem 1.25rem', borderRadius: 10, background: '#003057', color: '#fff', fontWeight: 700, fontSize: '0.875rem' }}>
        처음 화면으로
      </Link>
    </div>
  );
}
