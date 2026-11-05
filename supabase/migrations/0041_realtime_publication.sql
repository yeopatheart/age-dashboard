-- 칠판(주문 목록)이 다른 기기의 주문 변경을 바로 받도록 두 테이블을 Realtime 발행(publication)에 넣는다.
-- RLS는 그대로다(로그인 사용자 전체 허용). Realtime은 구독자의 로그인 정보로 같은 규칙을 적용하므로 새 권한 설정은 없다.
-- 이미 들어 있으면 건너뛴다(다시 실행해도 오류 없음).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items') then
    alter publication supabase_realtime add table public.order_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_businesses') then
    alter publication supabase_realtime add table public.daily_businesses;
  end if;
end $$;
