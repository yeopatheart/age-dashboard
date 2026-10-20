-- 입력 이력에도 차수(1차/2차)를 남긴다. 기존 이력은 모두 1차.
alter table kakao_message_log
  add column round smallint not null default 1 check (round in (1, 2));
