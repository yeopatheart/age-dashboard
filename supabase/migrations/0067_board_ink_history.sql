-- 칠판 필기의 서버 이력(스냅샷). 오터치·지우개로 필기가 지워져도 이전 상태를 되찾을 수 있게 한다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL만 적용하면 된다(앱 코드 변경 없음). 앱은 이 테이블을 읽거나 쓰지 않으므로 적용 전후로 칠판·PC 화면은 그대로다.
--  - board_ink는 저장할 때마다 행 전체를 덮어쓴다(이전 상태가 남지 않는다). 그래서 board_ink가 UPDATE될 때 "덮어쓰기 직전 상태(OLD)"를 이 테이블에 남긴다.
--  - 남기는 때: (1) 같은 날짜·모니터의 마지막 스냅샷이 설정 간격(app_settings 'boardInkSnapshotMinutes', 숫자, 기본 30분, 5~240분으로 제한)보다 오래됐을 때,
--    (2) 점 수가 직전 저장보다 30% 이상 줄었을 때(지우개로 크게 쓸었거나 전체 지우기). (2)는 최소 1분 간격이다.
--    점 수 = 모든 획의 좌표 쌍 개수의 합(pts 배열 길이 / 2). 획 수는 지우개가 획을 쪼개면 오히려 늘 수 있어서 쓰지 않는다.
--    필기가 비어 있던 상태(점 0개)나 내용이 같은 저장은 남기지 않는다.
--  - rows_summary는 스냅샷을 만드는 시점의 그날 주문 목록(업체 카드·상품 줄·수량·단위·취소·포장 체크)이다. 주문은 UPDATE·DELETE로 덮어써져 이력이 없고,
--    필기는 줄·칸에 붙어(anchor = daily_businesses.id 또는 order_items.id) 저장되므로, 나중에 필기가 "어느 고객사의 어느 상품"인지 읽으려면 값을 같이 복사해 둬야 한다.
--    요약은 OLD 저장 시각이 아니라 스냅샷을 만드는 지금 기준이다(strokes_saved_at이 OLD 저장 시각). 주문이 그 사이 바뀌었으면 어긋날 수 있다.
--    모니터 1·2 배정은 화면이 계산하므로 요약은 sort_order 순서의 전체 목록이다.
--  - 보관은 7일. 스냅샷을 만들 때 같은 트리거에서 오래된 이력을 지운다(cron 없음). board_ink의 3일 보관과 별개다.
--  - 보기는 주문 목록 보기 권한(dashboard:view). 쓰기·지우기는 트리거만 한다(사용자 권한으로는 막는다).
--  - 안전장치: 이력 기록이 어떤 이유로 실패해도 칠판 저장은 절대 실패하지 않는다(트리거 안에서 오류를 잡아 경고만 남긴다).
--    요약 만들기가 실패하면 rows_summary만 비우고 필기는 남긴다.
--  - 되돌리기(즉시 끄기, 재배포 불필요): drop trigger if exists board_ink_history_snapshot on public.board_ink;
--    이력 테이블까지 지우려면 drop table public.board_ink_history; drop function public.board_ink_snapshot(); drop function public.board_ink_point_count(jsonb);
--  - Realtime 발행에는 넣지 않는다(변경 신호가 늘면 PC·칠판이 불필요하게 다시 읽는다).
create table if not exists public.board_ink_history (
  id bigint generated always as identity primary key,
  order_date date not null,
  monitor text not null,
  strokes jsonb not null check (jsonb_typeof(strokes) = 'array'),
  rows_summary jsonb,
  reason text not null check (reason in ('interval', 'drop')),
  stroke_count integer not null,
  point_count integer not null,
  strokes_saved_at timestamptz not null,
  captured_at timestamptz not null default now()
);

create index if not exists board_ink_history_row_idx on public.board_ink_history (order_date, monitor, captured_at desc);
create index if not exists board_ink_history_captured_idx on public.board_ink_history (captured_at);

alter table public.board_ink_history enable row level security;

drop policy if exists "board_ink_history select" on public.board_ink_history;
create policy "board_ink_history select" on public.board_ink_history for select using ((select public.has_perm('dashboard:view')));
-- 쓰기 정책은 만들지 않는다(RLS가 막는다). 테이블 권한도 한 번 더 회수한다. 트리거 함수(security definer)만 쓴다.
revoke insert, update, delete, truncate on public.board_ink_history from anon, authenticated;

-- 점 수: 모든 획의 pts(좌표 [x0, y0, x1, y1, ...]) 길이의 합 / 2.
create or replace function public.board_ink_point_count(p_strokes jsonb)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(sum(case when jsonb_typeof(s -> 'pts') = 'array' then jsonb_array_length(s -> 'pts') else 0 end), 0)::integer / 2
  from jsonb_array_elements(case when jsonb_typeof(p_strokes) = 'array' then p_strokes else '[]'::jsonb end) as s
$$;

create or replace function public.board_ink_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric;
  v_last timestamptz;
  v_reason text;
  v_old_points integer;
  v_new_points integer;
  v_summary jsonb;
begin
  begin
    select max(h.captured_at) into v_last
    from public.board_ink_history h
    where h.order_date = old.order_date and h.monitor = old.monitor;

    select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end into v_minutes
    from public.app_settings s
    where s.key = 'boardInkSnapshotMinutes';
    v_minutes := least(240, greatest(5, floor(coalesce(v_minutes, 30))));

    if v_last is null or v_last <= now() - make_interval(mins => v_minutes::integer) then
      v_reason := 'interval';
    elsif v_last <= now() - interval '1 minute' then
      v_old_points := public.board_ink_point_count(old.strokes);
      v_new_points := public.board_ink_point_count(new.strokes);
      if v_old_points > 0 and v_new_points <= v_old_points * 0.7 then
        v_reason := 'drop';
      end if;
    end if;

    if v_reason is null then
      return new;
    end if;

    v_old_points := coalesce(v_old_points, public.board_ink_point_count(old.strokes));
    if v_old_points = 0 then
      return new; -- 비어 있던 상태는 남길 것이 없다
    end if;

    begin
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', db.id,
          'number', db.business_number,
          'name', coalesce(db.display_name, b.name),
          'sort', db.sort_order,
          'round', db.round,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', oi.id,
                'seq', oi.product_sequence,
                'name', oi.product_name_raw,
                'qty', oi.quantity,
                'unit', oi.unit,
                'size', oi.size_request,
                'status', oi.change_status,
                'packed', oi.is_packed
              ) order by oi.product_sequence
            )
            from public.order_items oi
            where oi.daily_business_id = db.id
          ), '[]'::jsonb)
        ) order by db.sort_order
      ), '[]'::jsonb) into v_summary
      from public.daily_businesses db
      join public.businesses b on b.id = db.business_id
      where db.order_date = old.order_date;
    exception when others then
      v_summary := null;
      raise warning 'board_ink_snapshot: rows_summary skipped (% %)', sqlstate, sqlerrm;
    end;

    insert into public.board_ink_history (order_date, monitor, strokes, rows_summary, reason, stroke_count, point_count, strokes_saved_at)
    values (old.order_date, old.monitor, old.strokes, v_summary, v_reason, jsonb_array_length(old.strokes), v_old_points, old.updated_at);

    delete from public.board_ink_history where captured_at < now() - interval '7 days';
  exception when others then
    -- 이력은 부가 기능이다. 어떤 오류든 칠판 저장을 막지 않는다.
    raise warning 'board_ink_snapshot: skipped (% %)', sqlstate, sqlerrm;
  end;
  return new;
end;
$$;

-- 트리거 전용 함수라 호출자가 직접 실행할 일이 없다.
revoke execute on function public.board_ink_snapshot() from public, anon, authenticated;
revoke execute on function public.board_ink_point_count(jsonb) from public, anon;

drop trigger if exists board_ink_history_snapshot on public.board_ink;
create trigger board_ink_history_snapshot
  after update on public.board_ink
  for each row
  when (old.strokes is distinct from new.strokes)
  execute function public.board_ink_snapshot();
