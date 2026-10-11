-- 상품·터미널 색상(팔레트 key) 설정과 상품의 등록 방식 구분.
-- fill_color/border_color가 null이면 기본 모양(상품: 슬레이트 팁, 터미널: 이름 해시 자동 색)을 쓴다.
alter table products
  add column fill_color text,
  add column border_color text,
  add column created_via text not null default 'manual' check (created_via in ('order', 'manual'));

alter table terminals
  add column fill_color text,
  add column border_color text;

-- 지금까지 주문에 들어온 상품 이름을 상품 목록으로 가져온다(색은 상품 관리 화면의 "색상 자동 배정"으로 채운다).
insert into products (name, created_via)
select distinct product_name_raw, 'order' from order_items
on conflict (name) do nothing;
