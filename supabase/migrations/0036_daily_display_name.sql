-- 그날 카드에서만 쓰는 고객명. 별도 주문(택배·직배송)은 받는 분 이름이 날짜마다 달라서 고객사 이름(businesses.name)을 바꾸지 않고
-- 그날 카드의 표시 이름만 바꾼다. null이면 고객사 이름을 그대로 쓴다. 고객사 관리·리포트·박스 추천 학습은 고객사 이름을 그대로 쓴다.
alter table daily_businesses add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 60);
