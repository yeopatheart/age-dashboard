-- 정산 1단계: 사업자(우리 쪽 사업자등록)와 매입처 마스터. 설계는 docs/prd/settlement.md.
-- 고객사(businesses)의 등록번호·대표자 열과는 별개다: 이쪽은 판매·매입 건을 "어느 사업자 명의로 처리하는지" 구분하는 우리 쪽 사업자다.
-- 정산·사업자 관리는 master만 기본으로 보므로 권한 마이그레이션은 없다(필요한 사용자는 사용자 및 권한 화면에서 켠다).

-- 사업자등록증 정보. 사업자등록번호는 숫자 10자리로 저장하고(화면에서 123-45-67890으로 보여 준다) 중복을 막는다.
create table seller_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60), -- 상호(법인명)
  representative_name text check (representative_name is null or char_length(representative_name) <= 40), -- 대표자(성명)
  registration_no text not null unique check (registration_no ~ '^[0-9]{10}$'),
  opened_on date, -- 개업연월일
  address text check (address is null or char_length(address) <= 200), -- 사업장 소재지
  business_type text check (business_type is null or char_length(business_type) <= 60), -- 업태
  business_item text check (business_item is null or char_length(business_item) <= 60), -- 종목
  memo text check (memo is null or char_length(memo) <= 500),
  created_at timestamptz not null default now()
);

-- 매입처(상품을 사 오는 곳)
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  phone text check (phone is null or char_length(phone) <= 40),
  memo text check (memo is null or char_length(memo) <= 500),
  created_at timestamptz not null default now()
);

-- 상품 ↔ 매입처. 한 상품에 매입처가 여러 개일 수 있다. 상품이나 매입처를 지우면 연결도 함께 지워진다.
create table product_suppliers (
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, supplier_id)
);

create index product_suppliers_supplier_idx on product_suppliers(supplier_id);

alter table seller_businesses enable row level security;
alter table suppliers enable row level security;
alter table product_suppliers enable row level security;

create policy "auth all seller_businesses" on seller_businesses for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all suppliers" on suppliers for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all product_suppliers" on product_suppliers for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
