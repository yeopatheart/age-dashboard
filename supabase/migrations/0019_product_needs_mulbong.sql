-- 물봉(산소) 포장이 필요한 상품 표시. 포장 추천 때 이런 상품은 물봉용 박스에 담는다.
alter table products add column needs_mulbong boolean not null default false;
