'use client';
import { useEffect } from 'react';

// 화면을 그리다 서버·네트워크 오류가 나면 흰 화면이나 기본 오류 대신 이 안내를 보여 준다. 사이드바(layout)는 그대로 둔다.
// 칠판처럼 아무도 만지지 않는 화면이 일시적 오류(네트워크·인증 서버 지연)로 멈춰 있지 않도록 10초마다 스스로 다시 시도한다(읽기만 다시 한다).
// 운영 환경은 서버 오류 문구를 가리므로 원인은 digest로만 남는다 — 현장에서 알려 주면 Vercel 로그에서 찾을 수 있다.
const AUTO_RETRY_MS = 10_000;

export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') unstable_retry();
    }, AUTO_RETRY_MS);
    return () => clearInterval(timer);
  }, [unstable_retry]);
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '3rem 1rem', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.125rem', fontWeight: 800 }}>화면을 불러오지 못했습니다</h2>
      <p style={{ color: '#64748b', fontSize: '0.875rem', wordBreak: 'keep-all' }}>
        10초마다 자동으로 다시 시도합니다. 계속되면 아래 번호를 알려 주세요.
      </p>
      {error.digest && <code style={{ fontSize: '0.75rem', color: '#94a3b8' }}>오류 번호: {error.digest}</code>}
      <button
        type="button"
        onClick={() => unstable_retry()}
        style={{ padding: '0.5rem 1.25rem', borderRadius: 10, background: '#003057', color: '#fff', fontWeight: 700, fontSize: '0.875rem' }}
      >
        다시 시도
      </button>
    </div>
  );
}
