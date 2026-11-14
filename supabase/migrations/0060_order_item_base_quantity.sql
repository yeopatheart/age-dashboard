-- 주문 줄의 "처음 입력한 수량·단위". 이미 있던 줄의 수량을 나중에 고쳤을 때, 품목별 수량 칩에 변경분(+3kg, −1kg)을 보여 주려면
-- 고치기 전 수량을 알아야 한다(지금까지는 어디에도 저장하지 않았다). 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다. (코드는 이 열이 없어도 열리지만 변경분은 보이지 않는다.)

alter table public.order_items add column if not exists base_quantity numeric;
alter table public.order_items add column if not exists base_unit text;

-- 새 줄은 입력한 값이 곧 처음 값이다. 처음 값을 따로 넣어 주지 않은 모든 입력 경로(주문 입력·직접 추가·가져오기)가 같은 규칙을 쓰도록 DB에서 채운다.
create or replace function public.order_items_set_base()
returns trigger
language plpgsql
as $$
begin
  new.base_quantity := coalesce(new.base_quantity, new.quantity);
  new.base_unit := coalesce(new.base_unit, new.unit);
  return new;
end;
$$;

drop trigger if exists order_items_set_base on public.order_items;
create trigger order_items_set_base before insert on public.order_items
  for each row execute function public.order_items_set_base();

-- 이미 들어 있는 줄: 처음 값을 알 수 없으므로 지금 값을 처음 값으로 삼는다(이후에 고치는 것부터 변경분이 보인다).
-- 최근 이틀 안의 날짜만 채운다. 오래된 날짜는 null로 두고 화면은 변경분 없음으로 본다.
-- 주의: 이 UPDATE가 실시간 신호(Realtime)를 한 번 보내므로 칠판 소리가 한 번 울릴 수 있다. 영업 중이 아닐 때 적용한다.
update public.order_items oi
set base_quantity = oi.quantity, base_unit = oi.unit
from public.daily_businesses db
where db.id = oi.daily_business_id
  and db.order_date >= current_date - 2
  and oi.base_quantity is null;

-- 되돌리기(필요할 때만):
-- drop trigger order_items_set_base on public.order_items;
-- drop function public.order_items_set_base();
-- alter table public.order_items drop column base_quantity, drop column base_unit;
