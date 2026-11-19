-- 칠판 필기 이력의 보관 기준을 "7일"에서 "최근 N영업일"로 바꾼다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 0068(이력 v2)과 0070(시간대)이 먼저 적용돼 있어야 한다. 함수만 바꾸므로 앱 배포 전후 어느 쪽에 적용해도 안전하다.
-- 규칙
--  - 영업일 = 오늘(한국 시간) 이전·당일 날짜 중 이력이 있는 날짜(order_date). 일요일·공휴일처럼 이력이 없는 날은 세지 않으므로 월요일에는 토요일이 직전 영업일이 된다.
--  - 최신 날짜부터 N개를 남기고 그보다 오래된 날짜의 이력을 모두 지운다(오늘 이력이 아직 없는 새벽에는 직전 N일이 남아 있다가, 오늘 첫 이력이 생기면 가장 오래된 날이 지워진다).
--  - 오늘보다 뒤 날짜(내일 미리 입력한 주문의 필기)는 세지 않고 지우지도 않는다.
--  - N은 app_settings 'boardInkHistoryKeepDays'(1~30 정수, 기본 2). 없거나 잘못된 값이면 2로 본다.
--  - 삭제는 정기 점검(5분마다)과 급감 스냅샷을 남길 때 같은 함수로 한다(시간대와 상관없음).
-- 되돌리기: 0068의 board_ink_snapshot, 0070의 board_ink_snapshot_tick 정의를 다시 실행하면 7일 보관으로 돌아간다(삭제된 이력은 복구되지 않는다).

-- 보관할 영업일 수. 설정이 없거나 잘못되면 2.
create or replace function public.board_ink_history_keep_days()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days numeric;
begin
  begin
    select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end into v_days
    from public.app_settings s
    where s.key = 'boardInkHistoryKeepDays';
  exception when others then
    v_days := null;
  end;
  if v_days is null or floor(v_days) < 1 or floor(v_days) > 30 then
    return 2;
  end if;
  return floor(v_days)::integer;
end;
$$;

-- 최근 N영업일보다 오래된 이력을 지운다. 지운 행 수를 돌려준다.
create or replace function public.board_ink_history_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep integer := public.board_ink_history_keep_days();
  v_oldest_kept date;
  v_deleted integer;
begin
  -- 오늘 이전·당일 날짜 중 이력이 있는 날을 최신순으로 세어 N번째 날짜가 남길 가장 오래된 날이다. N일보다 적으면 지울 것이 없다.
  select d.order_date into v_oldest_kept
  from (
    select distinct h.order_date
    from public.board_ink_history h
    where h.order_date <= (now() at time zone 'Asia/Seoul')::date
    order by h.order_date desc
    offset v_keep - 1
    limit 1
  ) d;

  if v_oldest_kept is null then
    return 0;
  end if;

  delete from public.board_ink_history where order_date < v_oldest_kept;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 점 수 급감(drop) 스냅샷: 0068과 같고 보관 삭제만 prune으로 바꿨다.
create or replace function public.board_ink_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_points integer;
  v_new_points integer;
  v_last_drop timestamptz;
  v_summary jsonb;
  v_meta jsonb;
begin
  begin
    v_old_points := public.board_ink_point_count(old.strokes);
    if v_old_points = 0 then
      return new; -- 비어 있던 상태는 남길 것이 없다
    end if;
    v_new_points := public.board_ink_point_count(new.strokes);
    if v_new_points > v_old_points * 0.7 then
      return new; -- 30% 이상 줄어든 저장만 급감으로 본다
    end if;

    select max(h.captured_at) into v_last_drop
    from public.board_ink_history h
    where h.order_date = old.order_date and h.monitor = old.monitor and h.reason = 'drop';
    if v_last_drop is not null and v_last_drop > now() - interval '1 minute' then
      return new;
    end if;

    begin
      v_summary := public.board_ink_rows_summary(old.order_date);
      v_meta := public.board_ink_summary_meta(old.order_date);
    exception when others then
      v_summary := null;
      v_meta := null;
      raise warning 'board_ink_snapshot: rows_summary skipped (% %)', sqlstate, sqlerrm;
    end;

    insert into public.board_ink_history (order_date, monitor, strokes, rows_summary, meta, summary_version, reason, stroke_count, point_count, prev_point_count, new_point_count, strokes_saved_at)
    values (old.order_date, old.monitor, old.strokes, v_summary, v_meta, 2, 'drop', jsonb_array_length(old.strokes), v_old_points, v_old_points, v_new_points, old.updated_at);

    perform public.board_ink_history_prune();
  exception when others then
    -- 이력은 부가 기능이다. 어떤 오류든 칠판 저장을 막지 않는다.
    raise warning 'board_ink_snapshot: skipped (% %)', sqlstate, sqlerrm;
  end;
  return new;
end;
$$;

-- 정기 스냅샷: 0070과 같고 보관 삭제만 prune으로 바꿨다.
create or replace function public.board_ink_snapshot_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric;
  v_start numeric;
  v_end numeric;
  r record;
  v_points integer;
  v_last_cap timestamptz;
  v_last_saved timestamptz;
  v_last_strokes jsonb;
  v_cache jsonb := '{}'::jsonb;
  v_key text;
  v_summary jsonb;
  v_meta jsonb;
  v_count integer := 0;
begin
  begin
    select
      max(case when s.key = 'boardInkSnapshotMinutes' and jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end),
      max(case when s.key = 'boardInkSnapshotStartHour' and jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end),
      max(case when s.key = 'boardInkSnapshotEndHour' and jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end)
    into v_minutes, v_start, v_end
    from public.app_settings s
    where s.key in ('boardInkSnapshotMinutes', 'boardInkSnapshotStartHour', 'boardInkSnapshotEndHour');
  exception when others then
    v_minutes := null;
    v_start := null;
    v_end := null;
  end;
  v_minutes := least(240, greatest(5, floor(coalesce(v_minutes, 10))));
  v_start := case when v_start is not null and floor(v_start) between 0 and 23 then floor(v_start) else 4 end;
  v_end := case when v_end is not null and floor(v_end) between 0 and 23 then floor(v_end) else 16 end;

  -- 보관: 시간대와 상관없이 점검마다 먼저 지운다. 삭제가 실패해도 이번 점검의 스냅샷은 계속 남긴다.
  begin
    perform public.board_ink_history_prune();
  exception when others then
    raise warning 'board_ink_snapshot_tick: prune skipped (% %)', sqlstate, sqlerrm;
  end;

  -- 시간대 밖이면 필기를 읽지도 않고 끝낸다.
  if not public.board_ink_snapshot_in_window(now(), v_start::integer, v_end::integer) then
    return 0;
  end if;

  for r in
    select bi.order_date, bi.monitor, bi.strokes, bi.updated_at
    from public.board_ink bi
    where bi.updated_at > now() - interval '2 days'
    order by bi.order_date, bi.monitor
  loop
    begin
      v_points := public.board_ink_point_count(r.strokes);
      continue when v_points = 0;

      select max(h.captured_at), max(h.strokes_saved_at) into v_last_cap, v_last_saved
      from public.board_ink_history h
      where h.order_date = r.order_date and h.monitor = r.monitor;
      -- 마지막 스냅샷 이후 저장이 없으면 남길 것이 없다.
      continue when v_last_saved is not null and r.updated_at <= v_last_saved;
      -- 설정 간격이 지났을 때만(30초 여유: 5분 주기가 조금 일찍 와도 같은 칸에 담는다).
      continue when v_last_cap is not null and v_last_cap > now() - make_interval(mins => v_minutes::integer) + interval '30 seconds';

      -- 같은 내용을 다시 저장했을 뿐이면(저장 시각만 바뀜) 남기지 않는다.
      select h.strokes into v_last_strokes
      from public.board_ink_history h
      where h.order_date = r.order_date and h.monitor = r.monitor
      order by h.captured_at desc, h.id desc
      limit 1;
      continue when v_last_strokes is not null and v_last_strokes = r.strokes;

      v_key := r.order_date::text;
      if not (v_cache ? v_key) then
        begin
          v_cache := v_cache || jsonb_build_object(v_key, jsonb_build_object(
            's', public.board_ink_rows_summary(r.order_date),
            'm', public.board_ink_summary_meta(r.order_date)
          ));
        exception when others then
          v_cache := v_cache || jsonb_build_object(v_key, jsonb_build_object('s', null, 'm', null));
          raise warning 'board_ink_snapshot_tick: rows_summary skipped (% %)', sqlstate, sqlerrm;
        end;
      end if;
      v_summary := v_cache -> v_key -> 's';
      v_meta := v_cache -> v_key -> 'm';
      -- jsonb null은 SQL null로 바꿔 저장한다.
      if jsonb_typeof(v_summary) = 'null' then v_summary := null; end if;
      if jsonb_typeof(v_meta) = 'null' then v_meta := null; end if;

      insert into public.board_ink_history (order_date, monitor, strokes, rows_summary, meta, summary_version, reason, stroke_count, point_count, strokes_saved_at)
      values (r.order_date, r.monitor, r.strokes, v_summary, v_meta, 2, 'interval', jsonb_array_length(r.strokes), v_points, r.updated_at);
      v_count := v_count + 1;
    exception when others then
      raise warning 'board_ink_snapshot_tick: % % skipped (% %)', r.order_date, r.monitor, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-- 트리거·정기 실행 전용 함수라 사용자가 직접 실행할 일이 없다.
revoke execute on function public.board_ink_history_keep_days() from public, anon, authenticated;
revoke execute on function public.board_ink_history_prune() from public, anon, authenticated;
revoke execute on function public.board_ink_snapshot() from public, anon, authenticated;
revoke execute on function public.board_ink_snapshot_tick() from public, anon, authenticated;
