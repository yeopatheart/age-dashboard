-- 송장 라벨: 박스 뚜껑 상단용·측면용 라벨의 디자인(label_templates)과, 박스 한 개마다 발급하는 바코드(box_labels), 출력·스캔 이력(box_label_events).
-- 라벨은 박스 할당 기록(packing_boxes, 다시 제출하면 지워졌다 새로 만들어진다)이 아니라 그날 업체 카드(daily_businesses)와 박스 순번에 붙인다.
-- 그래야 박스 할당을 고쳐서 다시 제출해도 이미 붙인 라벨의 바코드가 그대로 유효하다.

-- 라벨 종류별 크기(mm)와 항목 배치. elements = [{ id, type, field?, text?, x, y, w, h, fontSize?, bold?, align?, showText? }] (좌표·크기 단위 mm)
create table label_templates (
  kind text primary key check (kind in ('top', 'side')),
  width_mm numeric not null check (width_mm between 20 and 300),
  height_mm numeric not null check (height_mm between 10 and 300),
  elements jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 박스 하나의 바코드. barcode = YYMMDD(주문일) + 업체번호 3자리 + 박스 순번 2자리 + 확인 숫자 1자리 = 12자리.
-- loaded_at이 있으면 트럭에 상차 완료(스캔)된 박스다.
create table box_labels (
  id uuid primary key default gen_random_uuid(),
  daily_business_id uuid not null references daily_businesses(id) on delete cascade,
  seq integer not null check (seq between 1 and 99),
  barcode text not null unique check (barcode ~ '^[0-9]{12}$'),
  loaded_at timestamptz,
  loaded_by uuid,
  created_at timestamptz not null default now(),
  unique (daily_business_id, seq)
);
create index box_labels_daily_idx on box_labels(daily_business_id);

-- 출력(print)·상차 스캔(scan)·스캔 취소(undo) 이력. 재출력 횟수와 누가 언제 스캔했는지를 남긴다.
create table box_label_events (
  id uuid primary key default gen_random_uuid(),
  label_id uuid not null references box_labels(id) on delete cascade,
  event text not null check (event in ('print', 'scan', 'undo')),
  label_kind text check (label_kind in ('top', 'side')),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index box_label_events_label_idx on box_label_events(label_id, created_at desc);

alter table label_templates enable row level security;
alter table box_labels enable row level security;
alter table box_label_events enable row level security;

create policy "auth all label_templates" on label_templates for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all box_labels" on box_labels for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all box_label_events" on box_label_events for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
