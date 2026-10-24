-- 박스 추천 shadow test. 추천 모델은 박스 기록을 집계한 설명 가능한 모델이라, 하루에 한 번(그날 첫 접속 시)
-- 자동으로 다시 만들어 버전으로 저장한다. 추천은 만든 시점의 주문 내용(order_signature)과 함께 append-only로
-- 남기고, 현장에서 제출한 기록과 비교해 정확도를 측정한다.

-- 모델 버전 (version = 'v-YYYY-MM-DD'). 그날 이전의 제출 기록만으로 학습한 결과를 그대로 저장한다.
create table packing_model_versions (
  version text primary key,
  trained_at timestamptz not null default now(),
  record_count integer not null,
  single_box_count integer not null,
  model jsonb not null
);

-- 업체·일자별 추천. 주문이 바뀌면(order_signature가 달라지면) 새 행이 쌓인다 — 이전 행은 지우지 않는다.
-- candidates = 순위순 후보 [{ boxId, boxName, isMulbongBox, items: [{ orderItemId, quantity }] }[]]
create table packing_recommendations (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null references daily_businesses(id) on delete cascade,
  model_version text not null references packing_model_versions(version),
  order_signature text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  confidence_score numeric not null,
  candidates jsonb not null,
  created_at timestamptz not null default now(),
  unique (daily_business_id, order_signature)
);
create index packing_recommendations_daily_idx on packing_recommendations(daily_business_id, created_at desc);

-- 제출 기록에 "그때 어떤 추천이 있었고 현장 결과와 얼마나 같았는지"를 남긴다.
--   recommended_rank : 실제 박스 구성(종류·개수)이 추천 후보 몇 순위와 같은지 (1~3, 어느 후보와도 다르면 null)
--   accepted_as_is   : 1순위 추천을 상품 배치까지 그대로 제출했는지 (학습 때 가중치를 낮출 후보 표시)
--   order_signature  : 제출 시점의 주문 내용. 이후 주문이 바뀌면 현재 주문과 달라져 "박스 재확인" 대상이 된다.
alter table packing_records
  add column recommendation_id uuid references packing_recommendations(id) on delete set null,
  add column recommended_rank smallint check (recommended_rank between 1 and 3),
  add column accepted_as_is boolean,
  add column order_signature text;

alter table packing_model_versions enable row level security;
alter table packing_recommendations enable row level security;

create policy "auth all packing_model_versions" on packing_model_versions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all packing_recommendations" on packing_recommendations for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
