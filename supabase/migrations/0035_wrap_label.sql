-- 라벨을 박스 뚜껑 모서리에 감아 붙이는 한 장짜리로 바꾼다(상단 면 + 측면). 상단·측면 두 종류 디자인은 더 쓰지 않는다.
--  - label_templates: 한 장짜리는 kind = 'label' 한 행. 상단 면 높이(접히는 선 위치)와 측면에 붙는 폭을 따로 저장한다.
--    전체 높이(height_mm)는 상단 면 + 측면이고 프린터 용지 높이와 같다.
--  - 예전 'top'/'side' 행과 출력 이력(label_kind = 'top'/'side')은 지우지 않고 그대로 둔다(허용 값만 넓힌다).
alter table label_templates add column if not exists top_height_mm numeric check (top_height_mm between 10 and 300);
alter table label_templates add column if not exists side_width_mm numeric check (side_width_mm between 10 and 300);

do $$
declare
  c record;
begin
  for c in
    select con.conrelid::regclass as tbl, con.conname
    from pg_constraint con
    where con.contype = 'c'
      and con.conrelid in ('public.label_templates'::regclass, 'public.box_label_events'::regclass)
      and (pg_get_constraintdef(con.oid) ilike '%''top''%''side''%')
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table label_templates add constraint label_templates_kind_check check (kind in ('label', 'top', 'side'));
alter table box_label_events add constraint box_label_events_kind_check check (label_kind is null or label_kind in ('label', 'top', 'side'));
