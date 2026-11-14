-- 라벨 "실제 출력" 확정(스풀러 방식). 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다. 0051(box_labels.printed_box_type)이 먼저 적용돼 있어야 한다.
--
-- 흐름: 출력 버튼 → 서버가 작업(label_print_jobs, 상태 pending)을 만들고 인쇄 창의 문서 제목을 'AGE-LABEL-<작업 id>'로 바꿔 인쇄
--       → 프린터가 연결된 Windows PC의 에이전트가 인쇄 완료 이벤트(PrintService 307)에서 그 제목을 읽고 confirm_label_print를 호출
--       → 그때서야 박스 라벨 행(box_labels)·출력 이력(box_label_events)·출력한 박스 종류를 기록한다.
-- 그래서 확정 방식이 '스풀러'일 때는 인쇄 창을 열기만 한 라벨이 "출력"으로 기록되지 않는다. (설정 labelConfirmMode, 기본은 'button' = 예전처럼 버튼을 누르면 기록)

-- 1) 출력 작업. items = [{ daily_business_id, seq, barcode, printed_box_type }] — 인쇄한 순서 그대로(앞에서부터 N장이 인쇄됐다고 본다).
create table if not exists public.label_print_jobs (
  id uuid primary key default gen_random_uuid(),
  items jsonb not null,
  label_kind text, -- box_label_events.label_kind에 그대로 넘긴다(허용 값은 그쪽 제약이 정한다: 0035)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'printed', 'partial')),
  confirmed_at timestamptz,
  printed_count integer
);

create index if not exists label_print_jobs_pending_idx on public.label_print_jobs (created_at) where status = 'pending';

alter table public.label_print_jobs enable row level security;

drop policy if exists "label_print_jobs select" on public.label_print_jobs;
drop policy if exists "label_print_jobs insert" on public.label_print_jobs;
create policy "label_print_jobs select" on public.label_print_jobs for select using ((select auth.role()) = 'authenticated');
create policy "label_print_jobs insert" on public.label_print_jobs for insert with check (
  created_by = (select auth.uid()) and (select public.has_perm('packing:print'))
);
-- 수정·삭제 정책은 없다: 상태는 아래 confirm_label_print 함수만 바꾼다.

-- 2) 에이전트 비밀의 해시. 정책이 없어서 앱(anon·authenticated)은 읽을 수 없고, confirm_label_print(security definer)만 읽는다.
--    비밀 자체는 저장하지 않는다. 등록 방법은 scripts/label-agent/README.md 참고.
create table if not exists public.label_agent_keys (
  secret_hash text primary key,
  name text,
  created_at timestamptz not null default now()
);

alter table public.label_agent_keys enable row level security;

-- 3) 에이전트가 부르는 확정 함수. p_pages = 인쇄된 페이지 수(라벨 1장 = 1페이지). 앞에서부터 그만큼만 출력으로 기록한다.
--    같은 작업을 두 번 확정해도 이력이 중복되지 않는다. 비밀이 틀리면 예외를 던진다.
create or replace function public.confirm_label_print(p_job_id uuid, p_pages integer, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  job public.label_print_jobs;
  total integer;
  n integer;
  item jsonb;
  label_id uuid;
begin
  if p_secret is null or not exists (select 1 from public.label_agent_keys k where k.secret_hash = encode(digest(p_secret, 'sha256'), 'hex')) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select * into job from public.label_print_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if job.status <> 'pending' then
    return jsonb_build_object('status', 'already', 'confirmed', coalesce(job.printed_count, 0));
  end if;

  total := jsonb_array_length(job.items);
  n := least(greatest(coalesce(p_pages, 0), 0), total);
  if n = 0 then
    return jsonb_build_object('status', 'none');
  end if;

  for item in select e from jsonb_array_elements(job.items) with ordinality as t(e, i) where i <= n order by i loop
    insert into public.box_labels (daily_business_id, seq, barcode, printed_box_type)
    values ((item->>'daily_business_id')::uuid, (item->>'seq')::integer, item->>'barcode', item->>'printed_box_type')
    on conflict (daily_business_id, seq) do update set printed_box_type = excluded.printed_box_type
    returning id into label_id;
    insert into public.box_label_events (label_id, event, label_kind, created_by) values (label_id, 'print', job.label_kind, job.created_by);
  end loop;

  update public.label_print_jobs
  set status = case when n >= total then 'printed' else 'partial' end, confirmed_at = now(), printed_count = n
  where id = p_job_id;
  return jsonb_build_object('status', case when n >= total then 'printed' else 'partial' end, 'confirmed', n);
end;
$$;

revoke all on function public.confirm_label_print(uuid, integer, text) from public;
grant execute on function public.confirm_label_print(uuid, integer, text) to anon, authenticated;

-- 되돌리기(필요할 때만):
-- drop function public.confirm_label_print(uuid, integer, text);
-- drop table public.label_agent_keys;
-- drop table public.label_print_jobs;
