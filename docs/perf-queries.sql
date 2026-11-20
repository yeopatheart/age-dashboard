-- 성능 계측 기록(perf_events) 조회 모음. Supabase SQL Editor에서 실행한다(결정: docs/decisions/2026-11-20-perf-telemetry.md).
-- metric: load_block = 화면이 열린 뒤 10초 안에서 가장 길게 멈춘 시간(value_ms)과 멈춘 시간 합계(extra_ms)
--         nav        = 메뉴를 누른 뒤 새 화면이 그려지기까지(value_ms)
--         refresh    = 실시간 갱신(다시 받기) 한 번(value_ms)
-- 값은 ms. api가 longtask면 오래된 크롬이라 long-animation-frame 대신 longtask로 쟀다(수치가 조금 다르다).
-- monitor는 주문 목록(/dashboard)만 1·2·all, 나머지 화면은 null. 기기는 pointer(coarse=터치)·platform·viewport로 구분한다(칠판 TV = Linux + coarse).

-- 1) 최근 7일, 화면·항목·기기별 중앙값(p50)과 느린 쪽(p95), 최댓값
select metric, page, monitor, platform, pointer,
       count(*) as n,
       round(percentile_cont(0.5) within group (order by value_ms)) as p50_ms,
       round(percentile_cont(0.95) within group (order by value_ms)) as p95_ms,
       max(value_ms) as max_ms
from public.perf_events
where created_at > now() - interval '7 days'
group by 1, 2, 3, 4, 5
having count(*) >= 3
order by metric, page, monitor nulls last, platform;

-- 2) 배포 버전별 비교(배포 전후). build는 커밋 7자리, 같은 기기끼리 보려면 where에 platform·pointer를 추가한다.
select build, metric, page, monitor,
       count(*) as n,
       round(percentile_cont(0.5) within group (order by value_ms)) as p50_ms,
       round(percentile_cont(0.95) within group (order by value_ms)) as p95_ms,
       min(created_at) as first_seen
from public.perf_events
where created_at > now() - interval '14 days' and page = '/dashboard'
group by 1, 2, 3, 4
having count(*) >= 3
order by first_seen, metric, monitor;

-- 3) 하루 추이(주문 목록이 열릴 때 가장 길게 멈춘 시간, 한국 시간 날짜별)
select (created_at at time zone 'Asia/Seoul')::date as day, monitor,
       count(*) as n,
       round(percentile_cont(0.5) within group (order by value_ms)) as p50_ms,
       round(percentile_cont(0.95) within group (order by value_ms)) as p95_ms
from public.perf_events
where metric = 'load_block' and page = '/dashboard'
group by 1, 2
order by 1 desc, 2;

-- 4) 가장 느렸던 기록 20건(원인 추적용)
select created_at at time zone 'Asia/Seoul' as at_kst, metric, page, monitor, platform, pointer, viewport, build, value_ms, extra_ms, api
from public.perf_events
order by value_ms desc
limit 20;

-- 5) 수집이 되고 있는지(최근 1시간 기기·배포 버전별 건수)
select platform, pointer, viewport, build, count(*) as n, max(created_at at time zone 'Asia/Seoul') as last_kst
from public.perf_events
where created_at > now() - interval '1 hour'
group by 1, 2, 3, 4
order by last_kst desc;
