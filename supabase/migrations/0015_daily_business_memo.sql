-- 주문 입력 줄 끝의 "#메모"를 업체 카드(daily_businesses)에 저장한다.
alter table daily_businesses add column memo text;
