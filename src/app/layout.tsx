import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 글꼴은 빌드 때 받아서 우리 서버에서 내려준다(외부 Google Fonts 접속과 렌더 차단 없음). 실제로 쓰는 굵기만 싣는다.
const notoSansKr = Noto_Sans_KR({
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  preload: false,
  variable: "--font-noto-sans-kr",
});

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
    <html lang="ko" className={notoSansKr.variable}>
      <body>{children}</body>
    </html>
  );
}
