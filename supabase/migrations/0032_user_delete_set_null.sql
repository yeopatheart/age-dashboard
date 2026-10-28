-- 사용자를 삭제할 수 있게 한다. "누가 만들었는지/찍었는지/접속했는지" 컬럼이 profiles(id)를 ON DELETE 동작 없이
-- 참조해서, 그 사용자가 남긴 기록이 하나라도 있으면 삭제가 "Database error deleting user"로 막혔다.
-- 기록(행) 자체는 지우지 않고 작성자 칸만 비우도록(SET NULL) 바꾼다. 대상은 모두 NULL을 허용하는 컬럼이다.
-- profiles(id)를 참조하면서 삭제 동작이 없는 외래키를 찾아 같은 이름으로 다시 만든다.
do $$
declare
  fk record;
begin
  for fk in
    select c.conname, c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.confdeltype = 'a' -- a = NO ACTION
      and not a.attnotnull
  loop
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.profiles(id) on delete set null', fk.tbl, fk.conname, fk.col);
    raise notice 'on delete set null: %.%', fk.tbl, fk.col;
  end loop;
end $$;
