-- 정산 2단계: 판매내역에 사용자가 입력하는 값. 설계는 docs/prd/settlement.md.
-- 판매내역의 줄(고객·품목·수량)은 출고 완료된 주문 줄에서 읽을 때마다 계산하고, 여기에는 입력값만 저장한다.
-- 그래서 행은 사용자가 값을 처음 입력할 때 만들어지고, 주문 줄이 지워지면 함께 지워진다(on delete cascade).
-- 정산 메뉴는 master만 기본으로 보므로 권한 마이그레이션은 없다(필요한 사용자는 사용자 및 권한 화면에서 켠다).
create table settlement_sales (
  order_item_id uuid primary key references order_items(id) on delete cascade,
  seller_id uuid references seller_businesses(id) on delete set null, -- 사업자 구분. 사업자를 지우면 구분이 비게 된다
  price bigint check (price is null or price >= 0), -- 판매가: 그 줄의 총액(원). 비어 있으면 아직 입력 전
  paid boolean not null default false, -- 입금 여부(Y=true, 기본 N)
  memo text check (memo is null or char_length(memo) <= 500),
  updated_at timestamptz not null default now()
);

create trigger settlement_sales_set_updated_at before update on settlement_sales
  for each row execute function set_updated_at();

alter table settlement_sales enable row level security;

create policy "auth all settlement_sales" on settlement_sales for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
