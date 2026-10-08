-- 가족/직원 프로필 (auth.users 1:1)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 로그인/접근 기록 — 과거 직원이 유사 업종으로 창업한 사례가 있어, 역할 구분 없이
-- 전원이 동일한 데이터를 보는 대신 "누가 언제 접근했는지"만 추적한다
-- (docs/decisions/2026-09-29-order-dashboard-architecture.md 결정 8)
create table access_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  event text not null default 'login',
  created_at timestamptz not null default now()
);

-- updated_at 자동 갱신 — 이후 마이그레이션의 order_items 등에서도 재사용한다
create function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

alter table profiles enable row level security;
alter table access_log enable row level security;

-- 소규모 신뢰 팀, 행 단위 소유권 구분 없음: 로그인한 가족/직원 누구나 읽기/쓰기
-- (v1은 역할 구분 없음 — docs/decisions/2026-09-29-order-dashboard-architecture.md 결정 8)
create policy "auth read profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "auth all access_log" on access_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
