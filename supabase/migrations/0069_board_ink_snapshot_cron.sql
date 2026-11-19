-- 칠판 필기 정기 스냅샷을 5분마다 실행하도록 등록한다(0068의 board_ink_snapshot_tick). 여러 번 실행해도 같은 이름의 작업 하나만 남는다.
-- 적용 순서: 0068을 먼저 적용한다. 이 파일은 pg_cron 확장이 필요하다(Supabase SQL Editor의 postgres 권한으로 실행한다).
--  - pg_cron이 없는 환경(로컬 테스트 DB 등)에서는 이 파일을 적용하지 않는다. 0068만으로 칠판·PC 화면은 그대로이고 drop 스냅샷만 남는다.
--  - 간격은 이 작업이 아니라 설정(app_settings 'boardInkSnapshotMinutes', 기본 30분)이 정한다. 이 작업은 5분마다 "남길 때가 됐는지" 확인만 한다.
--  - 확인: select jobid, jobname, schedule, active from cron.job where jobname = 'board_ink_snapshot_tick';  실행 기록: select * from cron.job_run_details order by start_time desc limit 5;
--  - 중지: select cron.unschedule('board_ink_snapshot_tick');
create extension if not exists pg_cron;

select cron.schedule('board_ink_snapshot_tick', '*/5 * * * *', 'select public.board_ink_snapshot_tick()');
