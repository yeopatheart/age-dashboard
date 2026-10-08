"use server";

import { createClient } from "@/lib/supabase/server";

// 과거 직원이 유사 업종으로 창업한 사례가 있어, 역할 구분 없이 전원이 동일한 데이터를 보는
// 대신 "누가 언제 로그인했는지"만 추적한다 (docs/decisions/2026-09-29-order-dashboard-architecture.md 결정 8)
export async function logLoginEvent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return;
  await supabase.from("access_log").insert({ user_id: userId });
}
