import { redirect } from 'next/navigation';

// 로그인 여부 판단은 src/proxy.ts가 이미 처리한다(비로그인 시 /login으로 리다이렉트) —
// 여기까지 도달했다면 로그인된 상태이므로 대시보드로 보낸다.
export default function RootPage() {
  redirect('/dashboard');
}
