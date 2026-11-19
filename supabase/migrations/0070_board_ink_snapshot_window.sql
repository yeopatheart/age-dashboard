-- 칠판 필기 정기 스냅샷에 "이력을 남기는 시간대"를 더하고 기본 간격을 10분으로 바꾼다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 0068(정기 점검 함수)이 먼저 적용돼 있어야 한다. 이 SQL은 함수만 바꾸므로 앱 배포 전후 어느 쪽에 적용해도 안전하다.
-- 무엇이 바뀌나 (0068의 board_ink_snapshot_tick 대비)
--  1) 시간대: app_settings 'boardInkSnapshotStartHour'·'boardInkSnapshotEndHour'(0~23 숫자, 기본 4·16, 한국 시간). 시작 시각 정각부터 종료 시각 정각까지(종료 정각 포함)만 정기 스냅샷을 만든다.
--    4·16이면 04:00~16:00(마지막 점검은 16:00). 시작이 종료보다 크면 자정을 넘기는 시간대(22~6), 시작과 종료가 같으면 하루 종일. 값이 숫자가 아니거나 범위를 벗어나면 기본값(4·16)으로 본다.
--    시간대 밖에서는 점검이 바로 끝난다(필기를 읽지도 않는다). pg_cron은 계속 5분마다 이 함수를 부르고, 시간대는 설정으로 바꾼다(작업 일정을 다시 등록할 필요 없음).
--  2) 간격 기본값: 설정 'boardInkSnapshotMinutes'가 없으면 30분이 아니라 10분(5~240분으로 제한하는 것은 그대로).
--  - 필기가 크게 줄었을 때의 이력(drop 트리거, 0068)은 시간대와 상관없이 항상 남긴다(사고를 놓치지 않으려는 안전망이고, 쓰기 사건이 있을 때만 일어나 부담이 거의 없다).
--  - 보관 7일 삭제는 시간대와 상관없이 점검마다 먼저 한다.
--  - 되돌리기: 0068의 board_ink_snapshot_tick 정의를 다시 실행하면 이전 동작(시간대 없음, 기본 30분)으로 돌아간다.

-- 시간대 안인지(순수 판단). p_at을 한국 시간의 "그날 몇 분째"로 바꿔 시작 정각~종료 정각(포함)과 비교한다. 설정이 잘못됐으면 true(기록하는 쪽).
create or replace function public.board_ink_snapshot_in_window(p_at timestamptz, p_start integer, p_end integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_start is null or p_end is null or p_start < 0 or p_start > 23 or p_end < 0 or p_end > 23 or p_start = p_end then true
    else (
      select case
        when p_start < p_end then t.m between p_start * 60 and p_end * 60
        else t.m >= p_start * 60 or t.m <= p_end * 60
      end
      from (select (extract(hour from p_at at time zone 'Asia/Seoul') * 60 + extract(minute from p_at at time zone 'Asia/Seoul'))::integer as m) t
    )
  end
$$;

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

  -- 보관 7일: 시간대와 상관없이 점검마다 먼저 지운다.
  delete from public.board_ink_history where captured_at < now() - interval '7 days';

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

-- 정기 실행 전용 함수라 사용자가 직접 실행할 일이 없다.
revoke execute on function public.board_ink_snapshot_in_window(timestamptz, integer, integer) from public, anon, authenticated;
revoke execute on function public.board_ink_snapshot_tick() from public, anon, authenticated;
