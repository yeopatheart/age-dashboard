-- 박스 기록 재설계: "어느 박스에 어떤 상품이 담겼는지"를 업체·일자별로 제출 시점에 한 번에 저장한다
-- (박스 추천 모델의 학습 데이터). 박스 종류·상품 정보는 제출 시점 값을 복사해 저장해서, 나중에 주문이나
-- 박스 정보가 바뀌어도 기록이 변하지 않는다.
-- 기존 박스 기록(daily_business_boxes: 박스 종류+수량만 있고 상품 배치가 없음)은 테스트 데이터라 폐기한다.
drop table if exists daily_business_boxes;

create table packing_records (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null unique references daily_businesses(id) on delete cascade,
  order_date date not null,
  business_name text not null,
  terminal_name text,
  submitted_by uuid,
  submitted_at timestamptz not null default now()
);

create table packing_boxes (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references packing_records(id) on delete cascade,
  box_id uuid references boxes(id) on delete set null,
  position integer not null,
  box_name text not null,
  inner_width_cm numeric,
  inner_depth_cm numeric,
  inner_height_cm numeric,
  is_mulbong_box boolean not null default false
);

create table packing_box_items (
  id uuid primary key default gen_random_uuid(),
  packing_box_id uuid not null references packing_boxes(id) on delete cascade,
  order_item_id uuid references order_items(id) on delete set null,
  product_name text not null,
  unit text not null,
  quantity numeric not null,
  secondary_weight_kg numeric,
  size_request text,
  is_mulbong boolean not null default false,
  needs_mulbong boolean not null default false
);

create index packing_boxes_record_idx on packing_boxes(record_id);
create index packing_box_items_box_idx on packing_box_items(packing_box_id);

alter table packing_records enable row level security;
alter table packing_boxes enable row level security;
alter table packing_box_items enable row level security;

create policy "auth all packing_records" on packing_records for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all packing_boxes" on packing_boxes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all packing_box_items" on packing_box_items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
