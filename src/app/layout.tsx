import type { Metadata, Viewport } from "next";
// 글꼴(Noto Sans KR)은 npm 패키지(@fontsource)로 앱에 포함한다 — 빌드할 때 Google Fonts 접속이 필요 없다(next/font/google은 빌드 중 가져오기에 실패해 배포가 깨진 적이 있다).
// 실제로 쓰는 굵기만 싣는다. 한글은 글자 영역(unicode-range)별 조각 파일이라 화면에 나온 글자의 조각만 내려받는다.
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/600.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/noto-sans-kr/800.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "통영아재수산 관리자 시스템",
  description: "B2B 수산물 유통 업무 자동화 관리 시스템",
  // iPhone 홈 화면에 추가했을 때의 이름·아이콘·상태 표시줄(Safari는 manifest의 display를 따르지 않는다)
  appleWebApp: { capable: true, title: "아재수산", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// viewport-fit=cover: iPhone 하단 홈 인디케이터 영역까지 그리고, 하단 고정 바는 env(safe-area-inset-bottom)로 피한다.
// maximum-scale=1: 입력 글자를 표·필터와 같은 크기(16px 미만)로 통일했기 때문에, iOS가 입력칸을 누를 때 화면을 자동 확대하는 것을 막는다(2026-11-07 결정).
// iOS는 이 값을 줘도 핀치 확대는 그대로 되고, 안드로이드 크롬은 핀치 확대가 막힌다(접근성 설정 "강제 확대"를 켜면 가능).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#003057",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
