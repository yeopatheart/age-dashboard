-- 정산 2단계: 날짜별 품목 단가표 + 상품 줄 단위 매입 + 매입처별 지급 체크. 결정은 docs/decisions/2026-11-14-settlement-sheet.md.
-- 매입을 (출고일 × 품목)에서 상품 줄로 옮긴다: 같은 품목이어도 줄(고객)마다 매입처·매입단가가 다를 수 있다.
-- 기존 settlement_purchases 값은 시험 데이터라 옮기지 않고, 테이블도 지우지 않는다(읽기만 멈춘다. 삭제는 별도 마이그레이션).

-- 1. 날짜별 품목 단가표: 줄에 값이 없으면 이 표를 따른다(줄에서 고친 값이 우선).
create table settlement_prices (
  order_date date not null,
  product_name text not null check (char_length(product_name) between 1 and 100),
  sale_unit_price bigint check (sale_unit_price is null or sale_unit_price >= 0), -- 판매 단가(원/kg)
  supplier_id uuid references suppliers(id) on delete set null, -- 기본 매입처
  purchase_unit_price bigint check (purchase_unit_price is null or purchase_unit_price >= 0), -- 매입 단가(원/kg)
  updated_at timestamptz not null default now(),
  primary key (order_date, product_name)
);
create trigger settlement_prices_set_updated_at before update on settlement_prices
  for each row execute function set_updated_at();

-- 2. 상품 줄 단위 매입(줄에서 고친 값. null이면 단가표를 따른다)
alter table settlement_sales add column supplier_id uuid references suppliers(id) on delete set null;
alter table settlement_sales add column purchase_unit_price bigint check (purchase_unit_price is null or purchase_unit_price >= 0);
alter table settlement_sales add column purchase_price bigint check (purchase_price is null or purchase_price >= 0); -- 그 줄의 매입가 총액(원)

-- 3. 매입처별 지급 체크: 그날 그 매입처에 돈을 지급했는지
create table settlement_supplier_payments (
  order_date date not null,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  paid boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (order_date, supplier_id)
);
create trigger settlement_supplier_payments_set_updated_at before update on settlement_supplier_payments
  for each row execute function set_updated_at();

alter table settlement_prices enable row level security;
alter table settlement_supplier_payments enable row level security;

-- 정산 권한과 같다(0045): 보기=settlement:view, 쓰기=settlement:edit
create policy "settlement_prices select" on public.settlement_prices for select using ((select public.has_perm('settlement:view')));
create policy "settlement_prices insert" on public.settlement_prices for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_prices update" on public.settlement_prices for update using ((select public.has_perm('settlement:edit'))) with check ((select public.has_perm('settlement:edit')));
create policy "settlement_prices delete" on public.settlement_prices for delete using ((select public.has_perm('settlement:edit')));
create policy "settlement_supplier_payments select" on public.settlement_supplier_payments for select using ((select public.has_perm('settlement:view')));
create policy "settlement_supplier_payments insert" on public.settlement_supplier_payments for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_supplier_payments update" on public.settlement_supplier_payments for update using ((select public.has_perm('settlement:edit'))) with check ((select public.has_perm('settlement:edit')));
create policy "settlement_supplier_payments delete" on public.settlement_supplier_payments for delete using ((select public.has_perm('settlement:edit')));

-- 4. 상품명을 바꿀 때 정산의 이전 이름 행도 함께 바꾼다(품목 단가표가 새 이름을 따라가게). 권한은 0045와 같이 함수 안에서 확인한다.
create or replace function public.rename_purchase_product(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_perm('products:edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.settlement_purchases set product_name = p_new where product_name = p_old;
  -- 새 이름의 단가표 행이 같은 날 이미 있으면 그 행을 두고 이전 이름 행은 건드리지 않는다(기본키 충돌 방지).
  update public.settlement_prices p set product_name = p_new
    where p.product_name = p_old
      and not exists (select 1 from public.settlement_prices q where q.order_date = p.order_date and q.product_name = p_new);
end;
$$;
