-- 별도 주문 팝업의 펜 그림을 모니터 1·2와 따로 저장한다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 별도 주문 팝업 펜 동기화 코드를 배포한다(적용 전에는 팝업에서 그린 그림이 저장되지 않고 칠판에 안내가 뜬다).
--  - board_ink.monitor에 's'(별도 주문 팝업)를 더한다. 팝업은 상품 칩 배치가 모니터 1·2와 달라서 같은 문서를 쓰면 자유 필기가 엉뚱한 자리에 보인다.
alter table public.board_ink drop constraint if exists board_ink_monitor_check;
alter table public.board_ink add constraint board_ink_monitor_check check (monitor in ('1', '2', 's'));
