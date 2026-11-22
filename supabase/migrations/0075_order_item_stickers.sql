-- 상품 칸에 붙은 스티커(2026-11-22): 칠판의 상품 칸 하나에 붙인 "특대 2", "냉동실" 같은 표시. 종류 목록은 0074(sticker_presets).
-- 결정: docs/decisions/2026-11-22-stickers.md
-- - 붙을 당시의 이름·색을 복사해 둔다(스티커 목록을 고치거나 지워도 그날의 칠판은 그대로). preset_id는 참고용이라 목록에서 지우면 비운다.
-- - daily_business_id: 주문 목록이 업체 카드 id로 한 번에 읽도록 같이 저장한다(주문 줄을 먼저 읽고 또 읽는 왕복을 없앤다). 상품 줄은 카드를 옮기지 않으므로 값이 어긋나지 않는다.
-- - 한 칸에 같은 이름은 한 번만(unique), 한 칸에 최대 2개(트리거). 상품 줄·업체 카드가 지워지면 함께 지워진다.
-- - 권한: board_ink와 같다. 보기는 dashboard:view, 쓰기는 dashboard:edit(서버 동작도 같은 권한을 확인한다).
-- - 다른 기기가 바로 보도록 Realtime 발행에 넣는다(구독은 스티커를 붙이는 화면과 함께 추가한다. 발행에 넣는 것만으로는 아무 영향이 없다).
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다(없으면 주문 목록은 스티커 없이 그대로 열리고 서버 로그에만 남는다).
-- 되돌리기: drop table public.order_item_stickers; drop function public.enforce_order_item_sticker_limit();

create table if not exists public.order_item_stickers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  daily_business_id uuid not null references public.daily_businesses(id) on delete cascade,
  preset_id uuid references public.sticker_presets(id) on delete set null,
  label text not null check (char_length(label) between 1 and 8),
  fill_color text not null,
  border_color text not null,
  quantity integer check (quantity is null or quantity between 1 and 9999),
  created_at timestamptz not null default now()
);

create unique index if not exists order_item_stickers_item_label_key on public.order_item_stickers (order_item_id, label);
create index if not exists order_item_stickers_daily_idx on public.order_item_stickers (daily_business_id);

create or replace function public.enforce_order_item_sticker_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.order_item_stickers where order_item_id = new.order_item_id) >= 2 then
    raise exception 'a product cell can hold at most 2 stickers' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists order_item_stickers_limit on public.order_item_stickers;
create trigger order_item_stickers_limit before insert on public.order_item_stickers
  for each row execute function public.enforce_order_item_sticker_limit();

alter table public.order_item_stickers enable row level security;

drop policy if exists "order_item_stickers select" on public.order_item_stickers;
drop policy if exists "order_item_stickers insert" on public.order_item_stickers;
drop policy if exists "order_item_stickers update" on public.order_item_stickers;
drop policy if exists "order_item_stickers delete" on public.order_item_stickers;
create policy "order_item_stickers select" on public.order_item_stickers for select using ((select public.has_perm('dashboard:view')));
create policy "order_item_stickers insert" on public.order_item_stickers for insert with check ((select public.has_perm('dashboard:edit')));
create policy "order_item_stickers update" on public.order_item_stickers for update using ((select public.has_perm('dashboard:edit'))) with check ((select public.has_perm('dashboard:edit')));
create policy "order_item_stickers delete" on public.order_item_stickers for delete using ((select public.has_perm('dashboard:edit')));

revoke all on public.order_item_stickers from anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_item_stickers') then
    alter publication supabase_realtime add table public.order_item_stickers;
  end if;
end $$;
