-- 정산 배송비(버스·퀵·택배). 고객사별로 하루에 수단마다 한 번씩 붙는 비용이라 판매 줄(settlement_sales)과 따로 둔다.
-- 판매 줄에 넣으면 품목 통계·이익률·매입내역 자동 행이 오염된다. 설계는 docs/decisions/2026-11-14-settlement-shipping.md.

-- 1. 설정: 터미널은 퀵 가능 여부, 고객사는 이용하는 수단과 수단별 박스당 기본 금액.
--    고객사 금액이 null이면 그 수단을 쓰지 않는 고객사다(정산에 제안하지 않는다). 기본 금액은 "제안"일 뿐이고 날짜별 금액은 정산에서 고친다.
alter table terminals add column quick_allowed boolean not null default true;
alter table businesses add column bus_rate integer check (bus_rate is null or bus_rate >= 0);
alter table businesses add column quick_rate integer check (quick_rate is null or quick_rate >= 0);
alter table businesses add column parcel_rate integer check (parcel_rate is null or parcel_rate >= 0);

-- 2. 정산 배송비. 행은 그날 고객 카드(daily_businesses) × 수단 하나이고, 카드가 지워지면 함께 지워진다(settlement_sales와 같다).
create table settlement_shipping (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null references daily_businesses(id) on delete cascade,
  method text not null check (method in ('bus', 'quick', 'parcel')),
  boxes integer not null default 1 check (boxes >= 0 and boxes <= 9999),
  amount bigint not null check (amount >= 0), -- 그 수단의 배송비 총액(원)
  seller_id uuid references seller_businesses(id) on delete set null, -- 영수증에 올릴 사업자. 비어 있으면 그 고객의 판매 줄 사업자를 따른다
  paid boolean not null default false,
  memo text check (memo is null or char_length(memo) <= 500),
  updated_at timestamptz not null default now(),
  unique (daily_business_id, method)
);

create trigger settlement_shipping_set_updated_at before update on settlement_shipping
  for each row execute function set_updated_at();

alter table settlement_shipping enable row level security;

-- 정산 권한과 같다(0045): 보기=settlement:view, 쓰기=settlement:edit
create policy "settlement_shipping select" on public.settlement_shipping for select using ((select public.has_perm('settlement:view')));
create policy "settlement_shipping insert" on public.settlement_shipping for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_shipping update" on public.settlement_shipping for update using ((select public.has_perm('settlement:edit'))) with check ((select public.has_perm('settlement:edit')));
create policy "settlement_shipping delete" on public.settlement_shipping for delete using ((select public.has_perm('settlement:edit')));
