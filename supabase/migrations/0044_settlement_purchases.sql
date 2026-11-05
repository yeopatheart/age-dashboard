-- 정산 3단계: 매입내역에 사용자가 입력하는 값. 설계는 docs/prd/settlement.md.
-- 매입내역의 행은 "출고일 × 품목(상품명)" 하나다. 행 목록은 판매내역(출고 완료된 주문 줄)에서 읽을 때마다 계산하고,
-- 총 판매가·수익도 저장하지 않고 화면에서 계산한다. 여기에는 입력값만 저장한다.
-- 행은 사용자가 값을 처음 입력할 때 만들어지고, 그 뒤에는 판매내역이 바뀌어도 입력한 행이 사라지지 않는다.
-- 정산 메뉴는 master만 기본으로 보므로 권한 마이그레이션은 없다.
create table settlement_purchases (
  order_date date not null, -- 출고일(주문일)
  product_name text not null check (char_length(product_name) between 1 and 100), -- 품목 = 상품명
  seller_id uuid references seller_businesses(id) on delete set null, -- 사업자 구분. 사업자를 지우면 구분이 비게 된다
  supplier_id uuid references suppliers(id) on delete set null, -- 매입처. 매입처를 지우면 비게 된다
  price bigint check (price is null or price >= 0), -- 매입가(원). 비어 있으면 아직 입력 전
  paid boolean not null default false, -- 입금 여부(Y=true, 기본 N)
  memo text check (memo is null or char_length(memo) <= 500),
  updated_at timestamptz not null default now(),
  primary key (order_date, product_name)
);

create trigger settlement_purchases_set_updated_at before update on settlement_purchases
  for each row execute function set_updated_at();

alter table settlement_purchases enable row level security;

create policy "auth all settlement_purchases" on settlement_purchases for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
