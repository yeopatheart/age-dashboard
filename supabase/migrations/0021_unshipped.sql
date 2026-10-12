-- 미출고: 주문은 유효하지만 현장에서 출고하지 못한 수량. 주문취소(change_status = 'cancelled')와는 별개다.
-- unshipped_quantity = 0이면 정상, 주문 수량과 같으면 전량 미출고. 사유는 선택 입력.
alter table order_items
  add column unshipped_quantity numeric not null default 0 check (unshipped_quantity >= 0),
  add column unshipped_reason text;

-- 리포트 집계에 미출고 수량을 더한다(0017 함수 교체). 주문 수량(qty)은 그대로 두고 unshipped를 따로 센다.
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
