-- 대시보드 주문표에서 "오늘 특별히 눈에 띄게 볼 상품" 선택. 날짜별로 저장해서 매일 새로 고르고,
-- PC와 TV 화면이 같은 선택을 본다. position은 고른 순서(색을 순서대로 다르게 주는 데 쓴다).
create table daily_product_highlights (
  order_date date not null,
  product_name text not null,
  position int not null,
  created_at timestamptz not null default now(),
  primary key (order_date, product_name)
);
alter table daily_product_highlights enable row level security;
create policy "auth all daily_product_highlights" on daily_product_highlights for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
