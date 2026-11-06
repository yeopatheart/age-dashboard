import type { NextConfig } from "next";

// 브라우저가 직접 접속하는 곳은 Supabase(REST·Auth·Realtime)뿐이다. 그 외 외부 요청은 막는다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseConnect = supabaseUrl
  ? (() => {
      try {
        const { host } = new URL(supabaseUrl);
        return `https://${host} wss://${host}`;
      } catch {
        return "";
      }
    })()
  : "";

// nonce 기반 엄격 CSP는 정적 페이지(/login)와 인라인 style 속성 때문에 지금 구조에서는 화면이 깨진다.
// 그래서 스크립트·스타일의 인라인은 허용하되, 클릭재킹(frame-ancestors)·base 태그 변조·폼 탈취·외부 전송(connect-src)·
// 플러그인(object-src)은 막는다.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' ${supabaseConnect}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 카메라는 상차 스캔(/scan)에서만 쓴다.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
