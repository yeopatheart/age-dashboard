-- 별도 주문 팝업을 화면 1·2…로 나눠 쪽마다 그림을 따로 저장한다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 배포한다(적용 전에는 팝업 2쪽 이후에서 그린 그림이 저장되지 않고 칠판에 안내가 뜬다).
--  - board_ink.monitor: 1·2(주문 목록 모니터) + s1…s9(별도 주문 팝업의 쪽). 0058의 's'(쪽 구분 없음)도 이미 있을 수 있어 함께 허용한다.
alter table public.board_ink drop constraint if exists board_ink_monitor_check;
alter table public.board_ink add constraint board_ink_monitor_check check (monitor in ('1', '2') or monitor ~ '^s[1-9]?$');
