import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";
import { createRetryingFetch } from "./retry-fetch";

const retryingFetch = createRetryingFetch();

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // 읽기 요청은 일시적 실패(네트워크·502/503/504)를 두 번까지 다시 시도하고 8초에 끊는다(retry-fetch.ts). 쓰기는 다시 보내지 않는다.
      global: { fetch: retryingFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출되면 쓰기가 무시된다 — proxy.ts가 세션 갱신을 담당하므로 안전하다.
          }
        },
      },
    },
  );
}
