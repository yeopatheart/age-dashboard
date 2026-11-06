import Link from 'next/link';

// 어디에도 없는 주소(오타 등)로 들어왔을 때. 로그인 여부와 상관없이 처음 화면으로 돌아가는 길을 보여 준다.
export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 800 }}>페이지를 찾을 수 없습니다</h1>
      <p style={{ color: 'var(--muted-foreground)', wordBreak: 'keep-all' }}>주소가 바뀌었거나 잘못 입력되었을 수 있습니다.</p>
      <Link href="/" style={{ padding: '0.65rem 1.5rem', borderRadius: 10, background: 'var(--primary)', color: '#fff', fontWeight: 700 }}>
        처음 화면으로
      </Link>
    </main>
  );
}
