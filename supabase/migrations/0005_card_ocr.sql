-- 아크릴 카드 일괄 촬영 사진. 업로드 직후 pending으로 즉시 커밋되고, 백그라운드에서
-- Claude Vision 처리가 끝나면 done으로 바뀐다 (age-seafood의 classification_status와 동일 패턴)
create table card_photos (
  id uuid primary key default gen_random_uuid(),
  order_date date not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  taken_by uuid references profiles(id),
  taken_at timestamptz not null default now()
);

-- 사진 한 장에 카드가 여러 장 찍히므로 1:N. match_status로 자동 매칭 결과를 구분해
-- matched를 제외한 나머지만 사람이 확인 화면에서 수동으로 처리한다.
create table card_readings (
  id uuid primary key default gen_random_uuid(),
  card_photo_id uuid not null references card_photos(id) on delete cascade,
  raw_code text,
  raw_value text,
  business_number integer,
  product_sequence integer,
  matched_order_item_id uuid references order_items(id),
  match_status text not null default 'needs_review' check (match_status in ('matched', 'unmatched', 'ambiguous', 'needs_review')),
  created_at timestamptz not null default now()
);

create index card_readings_photo_idx on card_readings(card_photo_id);

alter table card_photos enable row level security;
alter table card_readings enable row level security;

create policy "auth all card_photos" on card_photos for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all card_readings" on card_readings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
