-- 사용자별 메뉴·기능 권한. master 계정(master@ageseafood.com)은 이 표와 무관하게 모든 권한을 가진다.
-- permissions = "메뉴:동작" 키 목록 (예: 'dashboard:view', 'dashboard:edit'). 키 목록은 src/lib/permissions/catalog.ts.
-- 읽기는 본인 행만 허용하고, 쓰기 정책은 두지 않는다 — 권한 변경은 서버(service_role 키)에서만 한다.
create table user_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table user_permissions enable row level security;

create policy "read own permissions" on user_permissions for select
  using (auth.uid() = user_id);
