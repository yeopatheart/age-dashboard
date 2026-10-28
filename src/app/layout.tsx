import type { Metadata } from "next";
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
