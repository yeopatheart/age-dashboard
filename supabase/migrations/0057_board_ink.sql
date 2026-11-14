-- 칠판 펜 그림을 서버에 저장해 PC에서도 보이게 한다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 펜 그림 동기화 코드를 배포한다(테이블이 없으면 화면은 열리지만 그림이 저장·표시되지 않는다).
--  - 날짜·모니터(1/2)마다 한 행이고 strokes에 획 전체를 JSON 배열로 통째로 둔다. 칠판이 그릴 때마다 통째로 덮어쓴다(여러 기기가 동시에 쓰면 마지막 저장이 남는다).
--  - 획 모양은 src/lib/ink/store.ts의 InkStroke: { id, color, width, pts: [x0, y0, ...], anchor?: 상품 줄 id }.
--  - 보기는 주문 목록 보기 권한(dashboard:view), 쓰기·지우기는 편집 권한(dashboard:edit). 보관은 3일이라 쓸 때마다 이틀 전보다 오래된 행을 지운다(앱에서).
--  - Realtime 발행에 넣어서 PC가 칠판의 변경을 바로 받는다(변경 신호만 쓰고 그림은 다시 읽는다).
create table if not exists public.board_ink (
  order_date date not null,
  monitor text not null check (monitor in ('1', '2')),
  strokes jsonb not null default '[]'::jsonb check (jsonb_typeof(strokes) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (order_date, monitor)
);

alter table public.board_ink enable row level security;

drop policy if exists "board_ink select" on public.board_ink;
drop policy if exists "board_ink insert" on public.board_ink;
drop policy if exists "board_ink update" on public.board_ink;
drop policy if exists "board_ink delete" on public.board_ink;
create policy "board_ink select" on public.board_ink for select using ((select public.has_perm('dashboard:view')));
create policy "board_ink insert" on public.board_ink for insert with check ((select public.has_perm('dashboard:edit')));
create policy "board_ink update" on public.board_ink for update using ((select public.has_perm('dashboard:edit'))) with check ((select public.has_perm('dashboard:edit')));
create policy "board_ink delete" on public.board_ink for delete using ((select public.has_perm('dashboard:edit')));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_ink') then
    alter publication supabase_realtime add table public.board_ink;
  end if;
end $$;
