-- 박스 종류별 내측 치수와 물봉(산소포장) 여부를 등록할 수 있게 한다. 박스 포장 추천 알고리즘을
-- 설계하려면 먼저 이 실측 데이터가 쌓여야 한다(0007의 빈 참조 테이블에 실제 값 넣는 단계).
alter table boxes
  add column inner_width_cm numeric,
  add column inner_depth_cm numeric,
  add column inner_height_cm numeric,
  add column is_mulbong_box boolean not null default false;
