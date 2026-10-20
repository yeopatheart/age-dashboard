-- 1) 차수(1차/2차): 같은 날 같은 고객사라도 차수가 다르면 별개의 업체 카드로 둔다. 기존 카드는 모두 1차.
alter table daily_businesses
  add column round smallint not null default 1 check (round in (1, 2));

alter table daily_businesses drop constraint daily_businesses_order_date_business_id_key;
alter table daily_businesses add constraint daily_businesses_order_date_business_id_round_key unique (order_date, business_id, round);

-- 2) 표시 순서: business_number는 발급 번호(unique, append-only)라 순서 조정에 쓰지 않고 sort_order를 따로 둔다.
--    새 카드는 트리거가 business_number를 넣어 항상 맨 뒤에 붙는다(발급 번호는 계속 증가하므로).
alter table daily_businesses add column sort_order integer;
update daily_businesses set sort_order = business_number;
alter table daily_businesses alter column sort_order set not null;

create function daily_businesses_default_sort_order() returns trigger as $$
begin
  if new.sort_order is null then
    new.sort_order := new.business_number;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger daily_businesses_sort_order_default
  before insert on daily_businesses
  for each row execute function daily_businesses_default_sort_order();

-- 배열 순서대로 sort_order를 1..n으로 한 번에 갱신한다(도중 실패해도 순서가 반쯤 바뀌지 않는다).
create function reorder_daily_businesses(p_ids uuid[]) returns void as $$
  update daily_businesses d
  set sort_order = o.ord
  from unnest(p_ids) with ordinality as o(id, ord)
  where d.id = o.id;
$$ language sql;

create index daily_businesses_date_sort_idx on daily_businesses(order_date, sort_order);
