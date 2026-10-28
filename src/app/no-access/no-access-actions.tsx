'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function NoAccessActions() {
  const router = useRouter();
  const logout = async () => {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  };
  return (
    <button onClick={logout} style={{ height: '2.75rem', padding: '0 1.2rem', borderRadius: 999, border: '1px solid #cbd5e1', fontWeight: 700 }}>
      로그아웃
    </button>
  );
}
