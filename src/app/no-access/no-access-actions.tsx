'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function NoAccessActions() {
  const router = useRouter();
  const logout = async () => {
    await createClient().auth.signOut({ scope: 'local' }); // 이 기기만(같은 계정의 다른 기기는 그대로 둔다)
    router.push('/login');
    router.refresh();
  };
  return (
    <button onClick={logout} style={{ height: '2.75rem', padding: '0 1.2rem', borderRadius: 999, border: '1px solid #cbd5e1', fontWeight: 700 }}>
      로그아웃
    </button>
  );
}
