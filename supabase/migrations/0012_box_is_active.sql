-- 박스별 사용 여부. 박스 포장 추천은 is_active = true인 박스만 후보로 삼는다
-- (더 이상 안 쓰는 박스를 지우지 않고 이력·치수는 남겨두기 위함).
alter table boxes
  add column is_active boolean not null default true;
