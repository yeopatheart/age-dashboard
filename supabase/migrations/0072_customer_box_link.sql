-- 고객사 간 합포장: 서로 다른 두 고객 카드의 각 1박스를 현장에서 한 박스로 합쳐 내보낸다(어머니가 박스 크기를 보고 포장 뒤에 정한다).
-- 두 업체에는 버스비·퀵비를 각각 청구하므로 정산은 그대로이고, 연결은 터미널 박스 수·상차 스캔·퀵 기사 글에만 쓰인다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다(코드가 이 열을 읽는다).
--
-- 저장: 카드마다 짝 카드의 id를 둔다(양쪽 카드에 서로를 기록). 박스를 다시 제출해도 daily_businesses는 유지되므로 연결도 유지된다.
-- 카드 하나가 지워지면 짝의 연결도 함께 풀린다(on delete set null).
-- 연결·해제는 아래 두 함수로만 한다: 두 카드를 한 번에 바꾸고 조건을 DB에서도 확인한다.
-- 되돌리기: drop function link_box_pair, unlink_box_pair; alter table daily_businesses drop column box_link_id;

alter table public.daily_businesses
  add column if not exists box_link_id uuid references public.daily_businesses(id) on delete set null;

alter table public.daily_businesses drop constraint if exists daily_businesses_box_link_not_self;
alter table public.daily_businesses add constraint daily_businesses_box_link_not_self check (box_link_id is null or box_link_id <> id);

-- 연결 조건(둘 다 만족해야 한다): 같은 날짜·같은 터미널(택배 터미널 제외), 서로 다른 카드, 아직 연결되지 않음,
-- 제출한 박스가 각각 1개, 취소된 카드가 아님, 상차된 박스가 없음.
create or replace function public.link_box_pair(p_a uuid, p_b uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_card record;
  v_date date;
  v_terminal uuid;
begin
  if p_a is null or p_b is null or p_a = p_b then
    raise exception '서로 다른 두 고객을 선택해야 합니다.';
  end if;

  -- 두 카드를 id 순서로 잠가, 동시에 서로 다른 짝을 고르는 경우에도 한쪽만 성공하게 한다.
  for v_card in
    select db.id, db.order_date, db.terminal_id, db.box_link_id, db.display_name
    from public.daily_businesses db
    where db.id in (p_a, p_b)
    order by db.id
    for update
  loop
    if v_date is null then
      v_date := v_card.order_date;
      v_terminal := v_card.terminal_id;
    elsif v_date <> v_card.order_date then
      raise exception '날짜가 다른 고객은 합포장할 수 없습니다.';
    elsif v_terminal is distinct from v_card.terminal_id then
      raise exception '터미널이 다른 고객은 합포장할 수 없습니다.';
    end if;
    if v_card.box_link_id is not null then
      raise exception '이미 다른 고객과 합포장으로 연결된 고객이 있습니다.';
    end if;
  end loop;

  if v_date is null or (select count(*) from public.daily_businesses where id in (p_a, p_b)) <> 2 then
    raise exception '고객을 찾지 못했습니다.';
  end if;

  if v_terminal is not null and exists (select 1 from public.terminals t where t.id = v_terminal and t.is_parcel) then
    raise exception '택배 터미널은 합포장할 수 없습니다.';
  end if;

  foreach v_id in array array[p_a, p_b] loop
    if (
      select count(*)
      from public.packing_records pr
      join public.packing_boxes pb on pb.record_id = pr.id
      where pr.daily_business_id = v_id
    ) <> 1 then
      raise exception '박스를 1개로 할당한 고객만 합포장할 수 있습니다.';
    end if;
    if exists (
      select 1 from public.order_items oi where oi.daily_business_id = v_id
    ) and not exists (
      select 1 from public.order_items oi where oi.daily_business_id = v_id and oi.change_status <> 'cancelled'
    ) then
      raise exception '주문이 모두 취소된 고객은 합포장할 수 없습니다.';
    end if;
    if exists (
      select 1 from public.box_labels bl where bl.daily_business_id = v_id and bl.loaded_at is not null
    ) then
      raise exception '이미 상차된 박스가 있는 고객은 합포장할 수 없습니다.';
    end if;
  end loop;

  update public.daily_businesses set box_link_id = p_b where id = p_a;
  update public.daily_businesses set box_link_id = p_a where id = p_b;
end;
$$;

-- 연결 해제: 어느 쪽 카드를 넘겨도 두 카드가 함께 풀린다. 연결되어 있지 않으면 아무것도 하지 않는다.
create or replace function public.unlink_box_pair(p_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select box_link_id into v_partner from public.daily_businesses where id = p_id for update;
  update public.daily_businesses set box_link_id = null where id = p_id;
  if v_partner is not null then
    update public.daily_businesses set box_link_id = null where id = v_partner and box_link_id = p_id;
  end if;
end;
$$;

revoke all on function public.link_box_pair(uuid, uuid) from public, anon;
revoke all on function public.unlink_box_pair(uuid) from public, anon;
grant execute on function public.link_box_pair(uuid, uuid) to authenticated;
grant execute on function public.unlink_box_pair(uuid) to authenticated;
