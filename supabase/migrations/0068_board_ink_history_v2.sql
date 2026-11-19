-- 칠판 필기 이력 v2: 이력 화면(/dashboard/history)이 칠판과 같은 표를 그릴 수 있게 요약을 늘리고, 정기 스냅샷을 시계 기준으로 바꾼다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL(0068)을 먼저 적용하고, 정기 실행 등록은 0069를 따로 적용한다. 0068만으로도 안전하다(앱은 이 테이블을 아직 읽지 않고, 정기 스냅샷은 0069를 적용하기 전까지 만들어지지 않는다).
--   그 사이에는 점 수 급감(drop) 스냅샷만 남는다. 0069 적용 전에 정기 스냅샷이 끊기는 것을 피하려면 0068과 0069를 이어서 적용한다.
--
-- 무엇이 바뀌나 (0067 대비)
--  1) 정기 스냅샷(reason 'interval')은 board_ink가 덮어써질 때가 아니라 5분마다 도는 함수(board_ink_snapshot_tick, pg_cron)가 만든다.
--     그 순간의 "현재 필기"와 "현재 주문 요약"을 한꺼번에 읽으므로 둘의 시각이 같다(0067은 직전 저장본 필기 + 지금 요약이라 주문이 바뀌면 어긋났다).
--     만드는 조건: 필기가 비어 있지 않고, 마지막 스냅샷 이후 저장이 있었고(strokes_saved_at 비교), 내용이 마지막 스냅샷과 다르고, 마지막 스냅샷이 설정 간격(app_settings 'boardInkSnapshotMinutes', 기본 30분, 5~240분)보다 오래됐을 때.
--     5분 주기라 실제 간격은 설정값 이상이며 가장 가까운 5분 단위로 올림된다(30초 여유를 둔다).
--  2) 점 수 급감 트리거(board_ink_history_snapshot)는 남긴다. 오터치·지우개로 크게 쓸었거나 전체 지우기를 하면 "덮어쓰기 직전 상태"를 reason 'drop'으로 남긴다.
--     급감을 알아볼 수 있게 직전·직후 점 수(prev_point_count, new_point_count)를 같이 기록한다. 이 스냅샷의 필기는 직전 저장본, 요약은 지금이라 시점이 어긋날 수 있다(strokes_saved_at이 필기 저장 시각).
--     drop은 같은 날짜·모니터의 직전 drop과 1분 이상 떨어져 있을 때만 만든다(정기 스냅샷 직후에 쓸어도 놓치지 않는다).
--  3) rows_summary(summary_version 2)에 표를 다시 그리는 데 필요한 값을 더한다: 업체의 터미널·별도 주문·택배 여부, 메모, 합포장, 박스 수, 업체 id, 기본 이름, 상품의 상품 id·미출고·보조 중량·물봉·기포기·기준 수량.
--     meta에는 그 시점의 터미널 색, 그날 주문에 나온 상품의 색, 그날 강조 상품을 담는다(주문 화면은 이 값을 현재 값으로 읽으므로 이력에서는 따로 남겨야 색이 어긋나지 않는다).
--     "박스 변경(주문이 바뀜)" 작은 배지는 제출 기록·추천 서명으로 앱이 계산하는 값이라 요약에 넣지 않았다(이력 화면에서는 그 배지만 생략된다).
--  4) 0067 때 만들어진 이력 행은 summary_version 1(옛 형식)로 남는다. 이력 화면은 이 행을 표로 재현하지 못하고 안내만 한다. 보관 7일이 지나면 사라진다.
--  - 보관은 7일(정기 함수가 돌 때와 drop 스냅샷을 만들 때 지운다).
--  - 안전장치: drop 트리거는 어떤 오류도 칠판 저장을 막지 않는다(오류를 잡아 경고만 남긴다). 정기 함수는 칠판 저장 경로와 무관하고, 한 행에서 실패해도 다른 행은 계속 처리한다.
--  - 되돌리기: 정기 실행 중지 select cron.unschedule('board_ink_snapshot_tick'); / drop 감지 중지 drop trigger if exists board_ink_history_snapshot on public.board_ink;

alter table public.board_ink_history add column if not exists summary_version smallint not null default 1;
alter table public.board_ink_history add column if not exists meta jsonb;
alter table public.board_ink_history add column if not exists prev_point_count integer;
alter table public.board_ink_history add column if not exists new_point_count integer;

-- 그날 주문 목록 요약(v2). 화면의 정렬(sort_order, 같으면 발급 번호순)과 같은 순서의 전체 목록이다. 모니터 배정은 이력 화면이 같은 규칙으로 다시 계산한다.
-- total_boxes: 박스 할당에서 제출한 박스 수. 제출 기록이 없으면 택배 터미널은 1, 나머지는 null(화면의 박스 열과 같은 규칙).
create or replace function public.board_ink_rows_summary(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', db.id,
      'number', db.business_number,
      'name', coalesce(db.display_name, b.name),
      'default_name', b.name,
      'business_id', db.business_id,
      'sort', db.sort_order,
      'round', db.round,
      'memo', db.memo,
      'merge_groups', db.merge_groups,
      'terminal', coalesce(t.name, ''),
      'separate', coalesce(t.is_separate, false),
      'parcel', coalesce(t.is_parcel, false),
      'total_boxes', case when bx.n > 0 then bx.n when coalesce(t.is_parcel, false) then 1 else null end,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'seq', oi.product_sequence,
            'product_id', oi.product_id,
            'name', oi.product_name_raw,
            'qty', oi.quantity,
            'unit', oi.unit,
            'size', oi.size_request,
            'status', oi.change_status,
            'packed', oi.is_packed,
            'unshipped_qty', oi.unshipped_quantity,
            'unshipped_reason', oi.unshipped_reason,
            'secondary_kg', oi.secondary_weight_kg,
            'mulbong', oi.is_mulbong,
            'aerator', oi.has_aerator,
            'base_qty', oi.base_quantity,
            'base_unit', oi.base_unit
          ) order by oi.product_sequence
        )
        from public.order_items oi
        where oi.daily_business_id = db.id
      ), '[]'::jsonb)
    ) order by db.sort_order, db.business_number
  ), '[]'::jsonb)
  from public.daily_businesses db
  join public.businesses b on b.id = db.business_id
  left join public.terminals t on t.id = db.terminal_id
  cross join lateral (
    select count(*)::integer as n
    from public.packing_records pr
    join public.packing_boxes pb on pb.record_id = pr.id
    where pr.daily_business_id = db.id
  ) bx
  where db.order_date = p_date
$$;

-- 표 색 등 "그 시점의 현재 값": 터미널(이름별), 그날 주문에 나온 상품(이름별), 그날 강조 상품(순서대로).
create or replace function public.board_ink_summary_meta(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'terminals', coalesce((
      select jsonb_object_agg(t.name, jsonb_build_object('fill', t.fill_color, 'border', t.border_color, 'separate', t.is_separate, 'parcel', t.is_parcel))
      from public.terminals t
    ), '{}'::jsonb),
    'products', coalesce((
      select jsonb_object_agg(p.name, jsonb_build_object('fill', p.fill_color, 'border', p.border_color))
      from public.products p
      where exists (
        select 1
        from public.order_items oi
        join public.daily_businesses db on db.id = oi.daily_business_id
        where db.order_date = p_date and oi.product_name_raw = p.name
      )
    ), '{}'::jsonb),
    'highlights', coalesce((
      select jsonb_agg(h.product_name order by h.position)
      from public.daily_product_highlights h
      where h.order_date = p_date
    ), '[]'::jsonb)
  )
$$;

-- 점 수 급감(drop) 스냅샷. 필기가 덮어써질 때 직전 상태(OLD)를 남긴다. 정기 스냅샷은 board_ink_snapshot_tick이 맡는다.
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

    delete from public.board_ink_history where captured_at < now() - interval '7 days';
  exception when others then
    -- 이력은 부가 기능이다. 어떤 오류든 칠판 저장을 막지 않는다.
    raise warning 'board_ink_snapshot: skipped (% %)', sqlstate, sqlerrm;
  end;
  return new;
end;
$$;

-- 정기 스냅샷. pg_cron이 5분마다 부른다(0069). 만든 스냅샷 수를 돌려준다.
create or replace function public.board_ink_snapshot_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric;
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
    select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end into v_minutes
    from public.app_settings s
    where s.key = 'boardInkSnapshotMinutes';
  exception when others then
    v_minutes := null;
  end;
  v_minutes := least(240, greatest(5, floor(coalesce(v_minutes, 30))));

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

  delete from public.board_ink_history where captured_at < now() - interval '7 days';
  return v_count;
end;
$$;

-- 트리거·정기 실행 전용 함수라 사용자가 직접 실행할 일이 없다.
revoke execute on function public.board_ink_snapshot() from public, anon, authenticated;
revoke execute on function public.board_ink_snapshot_tick() from public, anon, authenticated;
revoke execute on function public.board_ink_rows_summary(date) from public, anon, authenticated;
revoke execute on function public.board_ink_summary_meta(date) from public, anon, authenticated;

drop trigger if exists board_ink_history_snapshot on public.board_ink;
create trigger board_ink_history_snapshot
  after update on public.board_ink
  for each row
  when (old.strokes is distinct from new.strokes)
  execute function public.board_ink_snapshot();
