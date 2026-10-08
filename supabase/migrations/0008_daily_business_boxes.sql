-- Figma 매트릭스의 "박스" 열 — 업체(그날 카드)당 하나의 수동 입력 숫자. 상품별 박스 추천(0003의
-- order_items.box_result, 0007의 boxes 스캐폴드)과는 별개로, 지금은 사람이 직접 세서 적는 값이다.
alter table daily_businesses add column total_boxes integer not null default 1;
