-- 성능 정리 (감사 2026-11-06). 새 테이블은 없고 인덱스만 바꾼다. 여러 번 실행해도 같은 결과다.

-- 박스 추천 학습은 order_date < 기준일의 packing_records를 읽는다(src/lib/packing/server.ts). 날짜 인덱스가 없어 이력이 쌓일수록 전체를 훑는다.
create index if not exists packing_records_order_date_idx on public.packing_records (order_date);

-- 다른 인덱스가 같은 열을 앞에서부터 이미 덮고 있어 쓰기 비용만 드는 중복 인덱스를 지운다.
--   order_items_daily_business_idx  ← unique (daily_business_id, product_sequence) 가 덮는다 (0003)
--   daily_businesses_date_idx       ← daily_businesses_date_sort_idx (order_date, sort_order) 가 덮는다 (0025)
--   box_labels_daily_idx            ← unique (daily_business_id, seq) 가 덮는다 (0030)
drop index if exists public.order_items_daily_business_idx;
drop index if exists public.daily_businesses_date_idx;
drop index if exists public.box_labels_daily_idx;

-- 되돌리기(필요할 때만):
-- create index order_items_daily_business_idx on public.order_items (daily_business_id);
-- create index daily_businesses_date_idx on public.daily_businesses (order_date);
-- create index box_labels_daily_idx on public.box_labels (daily_business_id);
