-- 정산의 고객 단위 값: 사업자구분과 입금 여부는 그날 고객 카드(daily_businesses)마다 한 번 정한다. 결정은 docs/decisions/2026-11-14-settlement-sheet.md.
-- 이전에는 판매 줄(settlement_sales)·배송비 줄(settlement_shipping)마다 따로 저장했다. 그 열은 지우지 않고 읽기만 멈춘다(삭제는 현장 확인 뒤 별도 마이그레이션).
create table settlement_cards (
  daily_business_id uuid primary key references daily_businesses(id) on delete cascade,
  seller_id uuid references seller_businesses(id) on delete set null, -- 비어 있으면 고객사의 사업자구분(businesses.seller_id)을 따른다
  paid boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger settlement_cards_set_updated_at before update on settlement_cards
  for each row execute function set_updated_at();

alter table settlement_cards enable row level security;

-- 정산 권한과 같다(0045): 보기=settlement:view, 쓰기=settlement:edit
create policy "settlement_cards select" on public.settlement_cards for select using ((select public.has_perm('settlement:view')));
create policy "settlement_cards insert" on public.settlement_cards for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_cards update" on public.settlement_cards for update using ((select public.has_perm('settlement:edit'))) with check ((select public.has_perm('settlement:edit')));
create policy "settlement_cards delete" on public.settlement_cards for delete using ((select public.has_perm('settlement:edit')));

-- 지금까지 줄마다 넣은 값을 카드 단위로 옮긴다: 사업자는 가장 최근에 고친 줄의 값, 입금은 입력한 줄이 모두 Y일 때만 Y.
insert into settlement_cards (daily_business_id, seller_id, paid)
select
  oi.daily_business_id,
  (array_agg(ss.seller_id order by ss.updated_at desc) filter (where ss.seller_id is not null))[1],
  coalesce(bool_and(ss.paid), false)
from settlement_sales ss
join order_items oi on oi.id = ss.order_item_id
group by oi.daily_business_id
on conflict (daily_business_id) do nothing;
