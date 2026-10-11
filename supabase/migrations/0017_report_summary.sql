-- 기간별 리포트 집계. 행이 수만 건으로 늘어도(연 단위) 응답이 PostgREST 행 제한(1000)에 걸리지 않도록
-- 집계를 DB에서 끝내고 JSON 한 덩어리로 돌려준다. 취소된 상품은 제외한다.
-- security invoker(기본값)라 호출한 로그인 사용자의 RLS 정책이 그대로 적용된다.
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
         coalesce(oi.secondary_weight_kg, 0)::numeric as extra_kg
  from order_items oi
  join daily_businesses db on db.id = oi.daily_business_id
  join businesses b on b.id = db.business_id
  left join terminals t on t.id = b.terminal_id
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
  left join terminals t on t.id = b.terminal_id
  where db.order_date between p_from and p_to
)
select jsonb_build_object(
  'products', coalesce((
    select jsonb_agg(r) from (
      select product_name as name, unit, sum(qty) as qty, sum(extra_kg) as extra_kg,
             count(distinct order_date) as days, count(distinct business_id) as businesses
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
             sum(qty) as qty, sum(extra_kg) as extra_kg, count(*) as lines
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
             sum(qty) as qty, sum(extra_kg) as extra_kg, count(*) as lines
      from items group by terminal_name, unit
    ) r), '[]'::jsonb),
  'terminal_stats', coalesce((
    select jsonb_agg(r) from (
      select terminal_name as name,
             count(distinct order_date) as days, count(distinct business_id) as businesses,
             coalesce(sum(total_boxes), 0) as boxes
      from cards group by terminal_name
    ) r), '[]'::jsonb)
);
$$;
