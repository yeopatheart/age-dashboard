import { redirect } from 'next/navigation';
import { accessOrUnavailable, firstAllowedHref } from '@/lib/permissions/access';

// 로그인 여부 판단은 src/proxy.ts가 이미 처리한다(비로그인 시 /login으로 리다이렉트) —
// 여기까지 도달했다면 로그인된 상태이므로, 이 사용자가 열 수 있는 첫 메뉴로 보낸다.
// 로그인 확인이 일시적으로 실패한 경우는 "권한 없음"으로 보내지 않고 오류로 남긴다(다시 열면 된다).
export default async function RootPage() {
  redirect(firstAllowedHref(await accessOrUnavailable()) ?? '/no-access');
}
