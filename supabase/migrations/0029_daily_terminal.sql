-- 날짜별 터미널: 터미널을 고객사(businesses)에만 두면 같은 고객사가 어느 날 "택배"로 주문해도 항상 기본 터미널로 보인다.
-- 그날 주문 카드(daily_businesses)가 자기 터미널을 갖도록 하고, 고객사의 터미널은 "기본값"으로만 쓴다.
-- 같은 날·차수에 같은 고객사가 터미널별로 따로 카드를 가질 수 있다(예: 남부 1차 + 택배 1차).
alter table daily_businesses add column terminal_id uuid references terminals(id);

-- 기존 카드는 지금까지 화면에 보이던 터미널(고객사 기본 터미널)을 그대로 물려받는다.
update daily_businesses d
set terminal_id = b.terminal_id
from businesses b
where b.id = d.business_id;

-- 유일 키에 터미널을 포함한다. 터미널이 없는(null) 카드도 한 업체·차수에 하나만 허용하도록 null은 고정 uuid로 바꿔 비교한다.
alter table daily_businesses drop constraint daily_businesses_order_date_business_id_round_key;
create unique index daily_businesses_date_business_round_terminal_key
  on daily_businesses (order_date, business_id, round, coalesce(terminal_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 리포트의 터미널 집계도 그날 카드의 터미널을 기준으로 한다(0021 함수 교체: 터미널 조인만 b → db).
create or replace function report_summary(p_from date, p_to date)
returns jsonb
language sql
stable
as $$
with items as (
  select db.order_date,
         db.business_id,
         b.name as business_name,
         coalesce(t.name, '(터미널 없음)') as terminal_name,
         oi.product_name_raw as product_name,
         oi.unit,
         oi.quantity::numeric as qty,
         coalesce(oi.secondary_weight_kg, 0)::numeric as extra_kg,
         oi.unshipped_quantity::numeric as unshipped
  from order_items oi
  join daily_businesses db on db.id = oi.daily_business_id
  join businesses b on b.id = db.business_id
  left join terminals t on t.id = db.terminal_id
  where db.order_date between p_from and p_to
    and oi.change_status <> 'cancelled'
),
cards as (
  select db.order_date,
         db.business_id,
         b.name as business_name,
         coalesce(t.name, '(터미널 없음)') as terminal_name,
         db.total_boxes
  from daily_businesses db
  join businesses b on b.id = db.business_id
  left join terminals t on t.id = db.terminal_id
  where db.order_date between p_from and p_to
)
select jsonb_build_object(
  'products', coalesce((
    select jsonb_agg(r) from (
      select product_name as name, unit, sum(qty) as qty, sum(extra_kg) as extra_kg, sum(unshipped) as unshipped
      from items group by product_name, unit
    ) r), '[]'::jsonb),
  'product_stats', coalesce((
    select jsonb_agg(r) from (
      select product_name as name, count(distinct order_date) as days, count(distinct business_id) as businesses
      from items group by product_name
    ) r), '[]'::jsonb),
  'business_units', coalesce((
    select jsonb_agg(r) from (
      select business_name as name, terminal_name as terminal, unit,
             sum(qty) as qty, sum(extra_kg) as extra_kg, sum(unshipped) as unshipped, count(*) as lines
      from items group by business_name, terminal_name, unit
    ) r), '[]'::jsonb),
  'business_stats', coalesce((
    select jsonb_agg(r) from (
      select business_name as name, terminal_name as terminal,
             count(distinct order_date) as days, coalesce(sum(total_boxes), 0) as boxes
      from cards group by business_name, terminal_name
    ) r), '[]'::jsonb),
  'terminal_units', coalesce((
    select jsonb_agg(r) from (
      select terminal_name as name, unit,
             sum(qty) as qty, sum(extra_kg) as extra_kg, sum(unshipped) as unshipped, count(*) as lines
      from items group by terminal_name, unit
    ) r), '[]'::jsonb),
  'terminal_stats', coalesce((
    select jsonb_agg(r) from (
      select terminal_name as name, count(distinct order_date) as days,
             count(distinct business_id) as businesses, coalesce(sum(total_boxes), 0) as boxes
      from cards group by terminal_name
    ) r), '[]'::jsonb)
);
$$;
