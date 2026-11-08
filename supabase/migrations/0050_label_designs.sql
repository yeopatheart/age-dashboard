-- 라벨 디자인 보관함: 디자인을 여러 개 저장해 두고, 라벨 설정에서 "사용 중"으로 고른 하나로 출력한다.
--  - label_designs: 디자인 한 개 = 한 행(이름, 크기, 항목). 접는선은 항목(type = 'fold')이라 elements 안에 들어 있다. 접는선이 없으면 윗면 전용 라벨이다.
--  - 사용 중인 디자인의 id는 app_settings 'labelActiveDesign'에 저장한다(앱이 읽는다).
--  - 기존 label_templates 한 행은 "기존 디자인"으로 옮기고(top_height_mm → 접는선 위치, side_width_mm → 접는선 폭), 사용 중으로 지정한다.
--    label_templates 테이블은 지우지 않고 그대로 둔다(앱은 더 읽지 않는다). 지우는 것은 확인 뒤 따로 한다.
create table if not exists label_designs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  width_mm numeric not null check (width_mm between 20 and 300),
  height_mm numeric not null check (height_mm between 20 and 300),
  elements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists label_designs_name_key on label_designs (lower(btrim(name)));

alter table label_designs enable row level security;
drop policy if exists "auth all label_designs" on label_designs;
create policy "auth all label_designs" on label_designs for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 기존 디자인 옮기기(디자인이 하나도 없을 때만 — 다시 실행해도 중복되지 않는다)
insert into label_designs (name, width_mm, height_mm, elements)
select
  '기존 디자인',
  t.width_mm,
  t.height_mm,
  coalesce(t.elements, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'id', 'w-fold',
    'type', 'fold',
    'x', (t.width_mm - least(coalesce(t.side_width_mm, t.width_mm), t.width_mm)) / 2,
    'y', coalesce(t.top_height_mm, least(60, t.height_mm - 8)),
    'w', least(coalesce(t.side_width_mm, t.width_mm), t.width_mm),
    'h', 0
  ))
from label_templates t
where t.kind = 'label'
  and not exists (select 1 from label_designs);

insert into app_settings (key, value)
select 'labelActiveDesign', to_jsonb(d.id::text)
from label_designs d
where d.name = '기존 디자인'
on conflict (key) do nothing;
