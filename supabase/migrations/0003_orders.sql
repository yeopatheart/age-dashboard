-- "업체번호-상품순서" 코드 발급용 카운터. max(기존값)+1 방식은 항목 삭제 시 번호가
-- 재사용될 수 있어(요구사항: append-only, 삭제돼도 번호 재사용 금지) 날짜별 잠긴 카운터를 둔다.
create table order_day_counters (
  order_date date primary key,
  next_business_number integer not null default 1
);

-- 하루 안에서 업체 하나가 갖는 "카드". 같은 업체가 같은 날 여러 메시지에 걸쳐 언급돼도
-- 하나로 합쳐지며, 이 카드 헤더에 business_number가 1회만 표시된다.
create table daily_businesses (
  id uuid primary key default gen_random_uuid(),
  order_date date not null,
  business_id uuid not null references businesses(id),
  business_number integer not null,
  next_product_sequence integer not null default 1,
  created_at timestamptz not null default now(),
  unique (order_date, business_id),
  unique (order_date, business_number)
);

create index daily_businesses_date_idx on daily_businesses(order_date);

-- 업체 번호를 원자적으로 발급한다(동시 저장에도 중복·누락 없음). 입력 주체가 사실상
-- 1인이라 실질적 동시성 경쟁은 없지만, 행 잠금 방식이라 비용이 거의 없어 그대로 둔다.
create function assign_business_number(p_order_date date) returns integer as $$
declare
  v_next integer;
begin
  insert into order_day_counters (order_date, next_business_number)
  values (p_order_date, 1)
  on conflict (order_date) do nothing;

  update order_day_counters
  set next_business_number = next_business_number + 1
  where order_date = p_order_date
  returning next_business_number - 1 into v_next;

  return v_next;
end;
$$ language plpgsql security definer;

-- 상품 순서 번호를 업체 카드 단위로 원자적으로 발급한다
create function assign_product_sequence(p_daily_business_id uuid) returns integer as $$
declare
  v_next integer;
begin
  update daily_businesses
  set next_product_sequence = next_product_sequence + 1
  where id = p_daily_business_id
  returning next_product_sequence - 1 into v_next;

  return v_next;
end;
$$ language plpgsql security definer;

-- 주문 한 줄(업체×상품). 카카오 메시지 자체에는 번호가 없어 product_sequence는
-- 시스템이 assign_product_sequence로 발급한다. 화면의 "12-2" 코드는 저장 컬럼이 아니라
-- daily_businesses.business_number || '-' || order_items.product_sequence 로 조회 시점에 계산한다.
create table order_items (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null references daily_businesses(id) on delete cascade,
  product_sequence integer not null,
  product_id uuid references products(id),
  product_name_raw text not null,
  quantity numeric not null,
  unit text not null,
  secondary_weight_kg numeric,
  size_request text,
  is_mulbong boolean not null default false,
  mulbong_box_count integer,
  has_ice_pack boolean not null default false,
  from_stock boolean not null default false,
  change_status text not null default 'new' check (change_status in ('new', 'modified', 'cancelled', 'none')),
  measured_value text,
  is_packed boolean not null default false,
  packed_at timestamptz,
  box_result text,
  needs_review boolean not null default false,
  review_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_business_id, product_sequence)
);

create index order_items_daily_business_idx on order_items(daily_business_id);

create trigger order_items_set_updated_at before update on order_items
  for each row execute function set_updated_at();

alter table order_day_counters enable row level security;
alter table daily_businesses enable row level security;
alter table order_items enable row level security;

create policy "auth all order_day_counters" on order_day_counters for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all daily_businesses" on daily_businesses for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all order_items" on order_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
