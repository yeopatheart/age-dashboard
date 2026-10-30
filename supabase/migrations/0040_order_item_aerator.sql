-- 기포기: 물봉에 기포기를 부착해서 내보내는 주문. 물봉(is_mulbong, 물봉 안에 상품을 담는 것)과 구분해서 표시·집계한다.
-- 기포기 주문은 물봉도 함께 있는 것으로 저장한다(is_mulbong = true, has_aerator = true) — 박스 추천은 둘 다 물봉 박스로 간다.
-- 이미 들어온 과거 주문은 기포기였는지 알 수 없어 물봉으로 남는다.
alter table order_items add column has_aerator boolean not null default false;
