'use client';

// 화면 전체(루트 레이아웃)에서 오류가 났을 때의 마지막 안내. 이 화면은 앱의 스타일 없이 그려지므로 색을 직접 쓴다.
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'sans-serif' }}>
        <main role="alert" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800 }}>화면을 불러오지 못했습니다</h1>
          <p style={{ color: '#586579', wordBreak: 'keep-all' }}>잠시 후 다시 시도해 주세요. 계속되면 아래 번호를 알려 주세요.</p>
          {error.digest && <code style={{ fontSize: '0.75rem', color: '#586579' }}>오류 번호: {error.digest}</code>}
          <button type="button" onClick={() => unstable_retry()} style={{ padding: '0.65rem 1.5rem', borderRadius: 10, border: 0, background: '#003057', color: '#fff', fontWeight: 700 }}>
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
