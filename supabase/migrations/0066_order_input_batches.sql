-- 주문 입력(확정) 한 번이 만든 것·바꾼 것을 기록해서 "마지막 입력 되돌리기"를 할 수 있게 한다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다. 적용 전에 코드가 먼저 배포돼도 주문 입력은 그대로 되고(기록만 남지 않는다) 되돌리기 버튼만 보이지 않는다.
--  - effects(JSON)에 이 입력이 새로 만든 업체 카드·상품 줄, 수정·취소한 상품 줄의 이전 값, 바꾼 메모를 담는다(형식은 src/lib/order-input-undo.ts의 InputEffects).
--  - 되돌리면 새 줄은 지우지 않고 "취소" 상태로 바꾸고(칠판에 취소로 보인다), 수정·취소한 줄은 이전 값으로 돌린다. undone_at이 채워진 입력은 다시 되돌릴 수 없다.
--  - 기록은 지우지 않는다(delete 정책 없음). 보기는 주문 입력 보기 권한(orders:view), 쓰기·되돌리기는 편집 권한(orders:edit).
create table if not exists public.order_input_batches (
  id uuid primary key default gen_random_uuid(),
  order_date date not null,
  round integer not null default 1,
  raw_text text,
  effects jsonb not null check (jsonb_typeof(effects) = 'object'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid
);

create index if not exists order_input_batches_date_created_idx on public.order_input_batches (order_date, created_at desc);

alter table public.order_input_batches enable row level security;

drop policy if exists "order_input_batches select" on public.order_input_batches;
drop policy if exists "order_input_batches insert" on public.order_input_batches;
drop policy if exists "order_input_batches update" on public.order_input_batches;
create policy "order_input_batches select" on public.order_input_batches for select using ((select public.has_perm('orders:view')));
create policy "order_input_batches insert" on public.order_input_batches for insert with check ((select public.has_perm('orders:edit')));
create policy "order_input_batches update" on public.order_input_batches for update using ((select public.has_perm('orders:edit'))) with check ((select public.has_perm('orders:edit')));
