-- 스티커 목록(2026-11-22): 칠판의 상품 칸에 붙이는 작은 표시("특대", "냉동실" 등)의 종류. 어머니가 PC "스티커 관리"에서 추가·수정·삭제·순서 변경을 한다.
-- 결정: docs/decisions/2026-11-22-stickers.md. 상품 칸에 실제로 붙은 스티커는 다음 마이그레이션(order_item_stickers)에서 만든다. 이 SQL은 목록만 만든다.
-- 읽기는 로그인한 사용자 전체(칠판이 읽는다), 쓰기는 "스티커 관리" 권한(stickers:edit, 삭제는 stickers:delete)으로 DB에서도 막는다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다(없으면 스티커 관리 화면이 "마이그레이션 필요" 안내만 보인다).
-- 되돌리기: drop table public.sticker_presets;

create table if not exists public.sticker_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 8),
  fill_color text not null default 'amber',
  border_color text not null default 'amber',
  uses_quantity boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists sticker_presets_label_key on public.sticker_presets (label);

alter table public.sticker_presets enable row level security;

drop policy if exists "sticker_presets select" on public.sticker_presets;
create policy "sticker_presets select" on public.sticker_presets for select to authenticated using (true);

drop policy if exists "sticker_presets insert" on public.sticker_presets;
create policy "sticker_presets insert" on public.sticker_presets for insert to authenticated with check ((select public.has_perm('stickers:edit')));

drop policy if exists "sticker_presets update" on public.sticker_presets;
create policy "sticker_presets update" on public.sticker_presets for update to authenticated
  using ((select public.has_perm('stickers:edit'))) with check ((select public.has_perm('stickers:edit')));

drop policy if exists "sticker_presets delete" on public.sticker_presets;
create policy "sticker_presets delete" on public.sticker_presets for delete to authenticated using ((select public.has_perm('stickers:delete')));

revoke all on public.sticker_presets from anon;
