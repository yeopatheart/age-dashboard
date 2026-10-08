-- 붙여넣은 카카오톡 원문 로그. 파서가 놓친 줄을 나중에 디버깅하기 위한 용도로,
-- 다른 어떤 기능도 이 테이블을 읽어서 동작하지 않는다.
create table kakao_message_log (
  id uuid primary key default gen_random_uuid(),
  order_date date not null,
  raw_text text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table kakao_message_log enable row level security;
create policy "auth all kakao_message_log" on kakao_message_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
