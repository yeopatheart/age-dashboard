-- 성능 계측 기록(2026-11-20): 각 기기(칠판·PC·폰)가 "열릴 때 멈춤 / 화면 갱신 / 메뉴 이동" 시간을 모아 /api/perf로 보내면 여기에 쌓는다.
-- 고객명·주문 내용 같은 업무 데이터는 담지 않는다(화면 이름, 기기 구분, 배포 버전, 시간). 결정: docs/decisions/2026-11-20-perf-telemetry.md
-- 14일이 지난 기록은 저장 요청이 올 때 시간당 한 번 purge_perf_events()로 지운다(pg_cron을 쓰지 않는다).
-- 끄기: insert into app_settings (key, value) values ('perfEnabled', 'false') on conflict (key) do update set value = 'false', updated_at = now();
--       다시 켜기: update app_settings set value = 'true', updated_at = now() where key = 'perfEnabled';
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다(저장 API가 이 테이블에 쓴다. 없으면 계측만 실패하고 화면은 그대로다).
-- 되돌리기: drop function public.purge_perf_events(); drop table public.perf_events;

create table if not exists public.perf_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  metric text not null check (metric in ('load_block', 'nav', 'refresh')),
  value_ms integer not null check (value_ms between 0 and 600000),
  extra_ms integer check (extra_ms between 0 and 600000),
  page text not null check (char_length(page) between 1 and 64),
  monitor text check (monitor in ('1', '2', 'all')),
  pointer text check (pointer in ('coarse', 'fine')),
  platform text check (char_length(platform) <= 16),
  viewport text check (char_length(viewport) <= 16),
  build text check (char_length(build) <= 16),
  api text check (api in ('loaf', 'longtask'))
);

create index if not exists perf_events_created_at_idx on public.perf_events (created_at);
create index if not exists perf_events_metric_page_idx on public.perf_events (metric, page, created_at);

alter table public.perf_events enable row level security;

drop policy if exists "perf_events insert" on public.perf_events;
create policy "perf_events insert" on public.perf_events for insert to authenticated with check (true);
-- 조회는 시스템 설정 권한자만(Supabase SQL Editor는 이 정책과 상관없이 읽는다). 수정·삭제 정책은 없다(삭제는 아래 함수만).
drop policy if exists "perf_events select" on public.perf_events;
create policy "perf_events select" on public.perf_events for select using ((select public.has_perm('settings:view')));

revoke all on public.perf_events from anon;

create or replace function public.purge_perf_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.perf_events where created_at < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_perf_events() from public, anon;
grant execute on function public.purge_perf_events() to authenticated;
