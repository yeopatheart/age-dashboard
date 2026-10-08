-- 터미널/업체가 어떻게 처음 등록됐는지 구분한다: 'order'(주문 입력 확정 시 자동 등록) / 'manual'(관리 화면 등에서 직접 입력).
-- 기존 행은 모두 'manual'로 채워진다. terminals는 created_at이 없어서 같이 추가한다(기존 행은 실행 시각).
alter table terminals
  add column created_at timestamptz not null default now(),
  add column created_via text not null default 'manual' check (created_via in ('order', 'manual'));

alter table businesses
  add column created_via text not null default 'manual' check (created_via in ('order', 'manual'));
