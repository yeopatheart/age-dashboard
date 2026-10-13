-- 시스템 설정(config): 요구사항 해석의 허용 오차, 키워드, 미출고 사유 목록 등. 키마다 한 행, 값은 jsonb.
-- 저장된 값이 없으면 앱의 기본값(src/lib/app-settings.ts)을 쓴다.
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
create policy "auth all app_settings" on app_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 사이즈/종류 요구사항을 해석한 구조화 값(src/lib/size-spec.ts의 SizeSpec). 원문 size_request는 그대로 둔다.
alter table order_items add column size_spec jsonb;
