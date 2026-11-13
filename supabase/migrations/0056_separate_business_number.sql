-- 별도 주문(택배·직배송 등 is_separate 터미널)의 업체 번호를 일반 주문과 따로 발급한다.
-- 지금까지는 날짜당 카운터 하나로 모두 발급해서, 별도 주문을 먼저 입력하고 일반 주문을 이어 입력하면
-- 주문 목록의 번호가 38 → 54처럼 건너뛰어 보였다(2026-11-13).
--
-- 번호는 박스 라벨 QR의 "업체번호 3자리"에 들어가고 하루 안에서 유일해야 하므로(unique (order_date, business_number))
-- 별도 주문도 1번부터 새로 세지 않고 겹치지 않는 범위를 쓴다: 일반 1~500, 별도 501~999.
-- 이미 발급된 번호는 바꾸지 않는다(출력한 라벨 QR이 달라지면 스캔이 안 된다). 이 마이그레이션 뒤에 만드는 카드부터 적용된다.

alter table order_day_counters add column next_separate_number integer not null default 501;

-- 일반 주문: 기존과 같되 501을 넘기려 하면 별도 주문 범위와 겹치지 않도록 오류를 낸다. (create or replace는 search_path 설정을 지우므로 다시 지정한다.)
create or replace function assign_business_number(p_order_date date) returns integer as $$
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

  if v_next > 500 then
    raise exception '일반 주문 번호는 하루 500번까지입니다(501번부터는 별도 주문 번호).';
  end if;

  return v_next;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create function assign_separate_business_number(p_order_date date) returns integer as $$
declare
  v_next integer;
begin
  insert into order_day_counters (order_date, next_business_number)
  values (p_order_date, 1)
  on conflict (order_date) do nothing;

  update order_day_counters
  set next_separate_number = next_separate_number + 1
  where order_date = p_order_date
  returning next_separate_number - 1 into v_next;

  if v_next > 999 then
    raise exception '별도 주문 번호는 하루 999번까지입니다(라벨 번호가 3자리).';
  end if;

  return v_next;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.assign_separate_business_number(date) from public, anon;
grant execute on function public.assign_separate_business_number(date) to authenticated, service_role;
