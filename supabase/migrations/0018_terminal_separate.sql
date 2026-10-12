-- 택배·직배송처럼 터미널 주문표(대시보드 기본 화면)에 넣지 않고 별도 목록으로 보는 터미널 표시.
alter table terminals add column is_separate boolean not null default false;
