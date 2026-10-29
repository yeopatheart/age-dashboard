import type { MetadataRoute } from 'next';

// 휴대폰 홈 화면에 앱처럼 추가할 때의 이름·아이콘·색. Android Chrome은 "앱 설치/홈 화면에 추가"로, iPhone은 Safari 공유 → "홈 화면에 추가"로 쓴다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '통영아재수산 관리자',
    short_name: '아재수산',
    description: 'B2B 수산물 주문 관리 시스템',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#003057',
    theme_color: '#003057',
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
