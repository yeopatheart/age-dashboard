-- 리포트용 수집 보강. 지금 안 남아서 나중에 소급해 볼 수 없는 두 가지를 남기기 시작한다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다.

-- 1) 박스 할당 제출 이력. 제출할 때마다 packing_records를 지우고 다시 만들어서, 재제출 횟수·최초 제출 시각·최초 제출 때의 추천 적중 여부가 사라진다.
--    제출 한 번에 한 줄씩 쌓는다(수정·삭제 정책 없음). 업체명·터미널명은 주문 카드가 지워져도 이력이 남도록 복사해 둔다(FK는 set null).
--    추천 비교 값은 packing_records와 같은 뜻이다: recommended_rank=제출 박스 종류 구성이 후보 몇 번째와 같은지(없으면 null),
--    accepted_as_is=1순위 후보의 박스별 상품 배치와 완전히 같은지. 신뢰도는 recommendation_id로 packing_recommendations에서 읽는다.
create table if not exists public.packing_submit_events (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid references public.daily_businesses(id) on delete set null,
  order_date date not null,
  business_name text not null,
  terminal_name text,
  submitted_by uuid default auth.uid(),
  submitted_at timestamptz not null default now(),
  box_count integer not null check (box_count >= 0),
  items_verified boolean,
  order_signature text,
  recommendation_id uuid references public.packing_recommendations(id) on delete set null,
  recommended_rank smallint check (recommended_rank is null or recommended_rank between 1 and 3),
  accepted_as_is boolean
);

create index if not exists packing_submit_events_date_idx on public.packing_submit_events (order_date);
create index if not exists packing_submit_events_daily_idx on public.packing_submit_events (daily_business_id, submitted_at);

alter table public.packing_submit_events enable row level security;

drop policy if exists "packing_submit_events select" on public.packing_submit_events;
drop policy if exists "packing_submit_events insert" on public.packing_submit_events;
create policy "packing_submit_events select" on public.packing_submit_events for select using ((select public.has_perm('packing:view') or public.has_perm('reports:view')));
create policy "packing_submit_events insert" on public.packing_submit_events for insert with check (
  submitted_by = (select auth.uid()) and (select public.has_perm('packing:submit'))
);

-- 2) 주문 입력의 AI 보정 여부. AI가 형식을 벗어난 줄을 재구성한 줄이면 true. needs_review는 파서 불확실·수량 누락과 섞여 있어 따로 둔다.
--    기존 행은 false로 둔다(이 기능 이전 줄은 알 수 없다).
alter table public.order_items add column if not exists ai_repaired boolean not null default false;

-- 되돌리기(필요할 때만):
-- drop table public.packing_submit_events;
-- alter table public.order_items drop column ai_repaired;
