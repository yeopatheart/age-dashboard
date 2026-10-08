-- 박스 추천 학습/shadow 모드용 실사용 기록. 업체(daily_business)별로 실제 사용한 박스 종류·개수와
-- 상품별 실측 중량(kg)을 남긴다. 대시보드(TV)와는 별도의 "박스 기록" 화면에서만 입력한다.
alter table order_items add column measured_weight_kg numeric;

create table daily_business_boxes (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null references daily_businesses(id) on delete cascade,
  box_id uuid not null references boxes(id),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (daily_business_id, box_id)
);

alter table daily_business_boxes enable row level security;
create policy "auth all daily_business_boxes" on daily_business_boxes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
