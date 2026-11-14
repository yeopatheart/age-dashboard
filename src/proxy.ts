import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";
import { isTransientAuthError } from "@/lib/supabase/auth-errors";

const PUBLIC_PATHS = ["/login"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser()는 매 요청마다 Auth 서버에 네트워크 왕복을 해서 느리다. getClaims()는 JWKS를
  // 로컬(웹크립토)로 캐시해서 검증하므로 네트워크 없이 훨씬 빠르다 — 실제 데이터 접근은 어차피
  // Postgres RLS가 매 쿼리마다 다시 검증하므로, 여기서는 "로그인 페이지로 보낼지" 판단만 하면 된다.
  const { data, error } = await supabase.auth.getClaims();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!data?.claims && !isPublicPath) {
    // Auth 서버가 잠깐 늦거나 네트워크가 끊겨 확인하지 못한 것이면 로그인 화면으로 보내지 않는다(세션은 살아 있다).
    // 그대로 통과시키면 화면 쪽(getAccess)이 한 번 더 확인하고, 그래도 안 되면 "화면을 불러오지 못했습니다" 안내가 스스로 다시 시도한다.
    // 데이터는 어차피 Postgres RLS가 쿼리마다 검증하므로 여기서 통과시켜도 로그인 없이 읽히지 않는다.
    if (isTransientAuthError(error)) return response;
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const redirect = NextResponse.redirect(loginUrl);
    // 확인 중에 바뀐 쿠키(만료된 세션 쿠키 지우기 등)를 리다이렉트 응답에도 싣는다. 안 실으면 브라우저가 죽은 쿠키를 계속 보낸다.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  // 로그인 전에도 보여야 하는 정적 이미지(로그인 화면 로고 등)는 로그인 확인에서 뺀다 — 넣으면 /login으로 리다이렉트되어 이미지가 깨진다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
