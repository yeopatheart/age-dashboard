-- 고객사 단위 스티커(2026-11-23). 결정: docs/decisions/2026-11-23-business-stickers.md
-- 어머니가 "냉동실"처럼 상품이 아니라 고객사(주문 카드 한 장)에 붙이는 특이사항을 칠판의 고객명 칸에 스티커로 붙인다.
--  1) sticker_presets.scope: 스티커 목록의 스티커마다 붙이는 곳(item = 상품 칸, business = 고객사). 기존 스티커는 모두 'item'이다.
--  2) business_stickers: 고객사 카드에 붙은 스티커. 이름·색은 붙일 당시 값을 복사해 둔다(목록을 나중에 고치거나 지워도 그날의 칠판은 그대로).
-- 고객사용 스티커는 수량을 쓰지 않는다. 한 카드에 최대 2개, 같은 이름은 한 번만(상품 칸 스티커와 같은 규칙).

alter table public.sticker_presets add column if not exists scope text not null default 'item';

alter table public.sticker_presets drop constraint if exists sticker_presets_scope_check;
alter table public.sticker_presets add constraint sticker_presets_scope_check check (scope in ('item', 'business'));

alter table public.sticker_presets drop constraint if exists sticker_presets_business_no_quantity;
alter table public.sticker_presets add constraint sticker_presets_business_no_quantity check (scope <> 'business' or uses_quantity = false);

create table if not exists public.business_stickers (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null references public.daily_businesses(id) on delete cascade,
  preset_id uuid references public.sticker_presets(id) on delete set null,
  label text not null check (char_length(label) between 1 and 8),
  fill_color text not null,
  border_color text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists business_stickers_daily_label_key on public.business_stickers (daily_business_id, label);

-- 한 카드에 최대 2개(상품 칸과 같다). 동시에 붙여도 넘지 않게 DB가 막는다.
create or replace function public.enforce_business_sticker_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.business_stickers where daily_business_id = new.daily_business_id) >= 2 then
    raise exception 'a business card can hold at most 2 stickers' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists business_stickers_limit on public.business_stickers;
create trigger business_stickers_limit before insert on public.business_stickers
  for each row execute function public.enforce_business_sticker_limit();

-- 보기는 대시보드를 볼 수 있는 사람, 붙이고 떼는 것은 포장 체크와 같은 수정 권한(order_item_stickers와 같다).
alter table public.business_stickers enable row level security;

drop policy if exists "business_stickers select" on public.business_stickers;
drop policy if exists "business_stickers insert" on public.business_stickers;
drop policy if exists "business_stickers update" on public.business_stickers;
drop policy if exists "business_stickers delete" on public.business_stickers;
create policy "business_stickers select" on public.business_stickers for select using ((select public.has_perm('dashboard:view')));
create policy "business_stickers insert" on public.business_stickers for insert with check ((select public.has_perm('dashboard:edit')));
create policy "business_stickers update" on public.business_stickers for update using ((select public.has_perm('dashboard:edit'))) with check ((select public.has_perm('dashboard:edit')));
create policy "business_stickers delete" on public.business_stickers for delete using ((select public.has_perm('dashboard:edit')));

revoke all on public.business_stickers from anon;

-- 다른 기기의 칠판에도 바로 보이도록 실시간 발행에 넣는다.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'business_stickers') then
    alter publication supabase_realtime add table public.business_stickers;
  end if;
end $$;
