-- 고속버스 터미널 사전 등록 목록 (docs/kakao-message-format-guide.md)
create table terminals (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);
insert into terminals (name) values
  ('대구'), ('해운대'), ('남부'), ('인천'), ('울산'), ('포항'), ('경주'), ('진주');

-- 주문 업체 디렉터리 — 하루 단위가 아니라 계속 누적되는 마스터 목록
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  terminal_id uuid references terminals(id),
  notes text,
  created_at timestamptz not null default now()
);

-- 상품 마스터. 박스 포장 계산에 필요한 부피·크기 계수 등은 아직 넣지 않는다 —
-- 형의 엑셀 데이터와 어머니 인터뷰 결과가 오기 전까지는 숫자를 지어내지 않는다
-- (docs/prd/order-dashboard.md 미결 질문 2, 5)
create table products (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  category text,
  default_unit text,
  notes text,
  created_at timestamptz not null default now()
);

alter table terminals enable row level security;
alter table businesses enable row level security;
alter table products enable row level security;

create policy "auth read terminals" on terminals for select using (auth.role() = 'authenticated');
create policy "auth all businesses" on businesses for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all products" on products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
